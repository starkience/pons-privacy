import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  verifyTypedData,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  executionTypedData,
  LayerswapClient,
  ponsPrivacyAccountAbi,
  ponsPrivacyAccountFactoryAbi,
  type RelayExecutionRequest,
  type RelayerFee,
} from "@pons-privacy/sdk";
import {
  validateExecutionPolicy,
  type LayerswapReturnPolicyGateway,
} from "./execution-policy.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface PonsRelayerPolicy {
  chainId: 4663;
  factory: Address;
  fee: RelayerFee;
  maxCalldataBytes: number;
  maxDeadlineSeconds: number;
  maxPrefund: bigint;
}

export interface RelayerDependencies {
  publicClient: PublicClient;
  walletClient: WalletClient;
  relayerAccount: ReturnType<typeof privateKeyToAccount>;
  layerswap?: LayerswapReturnPolicyGateway;
}

export function validateStaticPolicy(
  request: RelayExecutionRequest,
  policy: PonsRelayerPolicy,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (request.chainId !== policy.chainId) throw new Error("wrong chain");
  if (getAddress(request.factory) !== getAddress(policy.factory)) {
    throw new Error("wrong account factory");
  }
  if (request.calls.length < 1 || request.calls.length > 2) {
    throw new Error("Pons relay permits one or two calls only");
  }
  if (request.deadline < BigInt(nowSeconds)) throw new Error("request expired");
  if (request.deadline > BigInt(nowSeconds + policy.maxDeadlineSeconds)) {
    throw new Error("deadline exceeds policy");
  }
  if (request.prefund > policy.maxPrefund)
    throw new Error("prefund exceeds policy");
  if (
    getAddress(request.fee.token) !== getAddress(policy.fee.token) ||
    request.fee.amount !== policy.fee.amount ||
    getAddress(request.fee.recipient) !== getAddress(policy.fee.recipient)
  ) {
    throw new Error("fee does not match relayer policy");
  }
  let calldataBytes = 0;
  for (const call of request.calls) {
    if (getAddress(call.target) === ZERO_ADDRESS)
      throw new Error("zero call target");
    calldataBytes += (call.data.length - 2) / 2;
  }
  if (calldataBytes > policy.maxCalldataBytes) {
    throw new Error("calldata exceeds policy");
  }
}

export class PonsPrivacyRelayer {
  constructor(
    readonly policy: PonsRelayerPolicy,
    readonly dependencies: RelayerDependencies,
  ) {}

  async relay(request: RelayExecutionRequest): Promise<Hash> {
    validateStaticPolicy(request, this.policy);
    const { publicClient, walletClient, relayerAccount } = this.dependencies;
    const predicted = await publicClient.readContract({
      address: this.policy.factory,
      abi: ponsPrivacyAccountFactoryAbi,
      functionName: "computeAddress",
      args: [request.owner, BigInt(request.accountIndex)],
    });
    if (getAddress(predicted) !== getAddress(request.account)) {
      throw new Error("account does not match factory owner/index derivation");
    }

    const signatureValid = await verifyTypedData({
      address: request.owner,
      ...executionTypedData({
        chainId: request.chainId,
        account: request.account,
        calls: request.calls,
        nonce: request.nonce,
        deadline: request.deadline,
        fee: request.fee,
        prefund: request.prefund,
      }),
      signature: request.signature,
    });
    if (!signatureValid) throw new Error("invalid owner signature");

    await validateExecutionPolicy(
      request,
      publicClient,
      this.dependencies.layerswap,
    );

    const code = await publicClient.getBytecode({ address: request.account });
    const currentNonce = code
      ? await publicClient.readContract({
          address: request.account,
          abi: ponsPrivacyAccountAbi,
          functionName: "nonce",
        })
      : 0n;
    if (currentNonce !== request.nonce) throw new Error("stale account nonce");

    const parameters = {
      account: relayerAccount,
      address: this.policy.factory,
      abi: ponsPrivacyAccountFactoryAbi,
      functionName: "deployAndExecute" as const,
      args: [
        request.owner,
        BigInt(request.accountIndex),
        [...request.calls],
        request.nonce,
        request.deadline,
        request.fee.token,
        request.fee.amount,
        request.fee.recipient,
        request.signature,
      ] as const,
      value: request.prefund,
    };
    const simulation = await publicClient.simulateContract(parameters);
    return walletClient.writeContract(simulation.request);
  }
}

export function relayerFromEnv(env: NodeJS.ProcessEnv): PonsPrivacyRelayer {
  const chainId = positiveInt(env.CHAIN_ID, "CHAIN_ID");
  if (chainId !== 4663)
    throw new Error("Pons relayer requires Robinhood mainnet chain 4663");
  const factory = requiredAddress(env.FACTORY_ADDRESS, "FACTORY_ADDRESS");
  const rpcUrl = required(env.RPC_URL, "RPC_URL");
  const privateKey = requiredHex(
    env.RELAYER_PRIVATE_KEY,
    "RELAYER_PRIVATE_KEY",
  );
  const relayerAccount = privateKeyToAccount(privateKey);
  const feeAmount = nonnegativeBigInt(
    env.RELAYER_FEE_AMOUNT ?? "0",
    "RELAYER_FEE_AMOUNT",
  );
  const feeToken = requiredAddress(
    env.RELAYER_FEE_TOKEN ?? ZERO_ADDRESS,
    "RELAYER_FEE_TOKEN",
  );
  const feeRecipient = requiredAddress(
    env.RELAYER_FEE_RECIPIENT ??
      (feeAmount === 0n ? ZERO_ADDRESS : relayerAccount.address),
    "RELAYER_FEE_RECIPIENT",
  );
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ transport });
  const walletClient = createWalletClient({
    account: relayerAccount,
    transport,
  });
  const layerswap = env.LAYERSWAP_API_KEY
    ? new LayerswapClient({ apiKey: env.LAYERSWAP_API_KEY })
    : undefined;

  return new PonsPrivacyRelayer(
    {
      chainId,
      factory,
      fee: { token: feeToken, amount: feeAmount, recipient: feeRecipient },
      maxCalldataBytes: positiveInt(
        env.MAX_CALLDATA_BYTES ?? "65536",
        "MAX_CALLDATA_BYTES",
      ),
      maxDeadlineSeconds: positiveInt(
        env.MAX_DEADLINE_SECONDS ?? "900",
        "MAX_DEADLINE_SECONDS",
      ),
      maxPrefund: nonnegativeBigInt(
        env.MAX_PREFUND_WEI ?? "500000000000000",
        "MAX_PREFUND_WEI",
      ),
    },
    {
      publicClient,
      walletClient,
      relayerAccount,
      ...(layerswap ? { layerswap } : {}),
    },
  );
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAddress(value: string | undefined, name: string): Address {
  return getAddress(required(value, name));
}

function requiredHex(value: string | undefined, name: string): Hex {
  const result = required(value, name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) {
    throw new Error(`${name} must be a 32-byte hex key`);
  }
  return result as Hex;
}

function positiveInt(value: string | undefined, name: string): number {
  const parsed = Number(required(value, name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonnegativeBigInt(value: string | undefined, name: string): bigint {
  const parsed = required(value, name);
  if (!/^(0|[1-9][0-9]*)$/.test(parsed)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return BigInt(parsed);
}
