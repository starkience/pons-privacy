import type {
  DerivedPonsPrivacyIdentity,
  LayerswapFundingAction,
} from "@pons-privacy/sdk";
import { LAYERSWAP_STARKNET_USDC_ADDRESS } from "@pons-privacy/sdk";
import {
  Account,
  PaymasterRpc,
  RpcError,
  RpcProvider,
  type Call,
  type PaymasterDetails,
} from "starknet";
import { requireStarknetAddress } from "./config.js";

export interface TransportAccountConfig {
  readonly rpcUrl: string;
  /** Same-origin production proxy; the AVNU API key stays server-side. */
  readonly paymasterUrl: string;
  readonly ozAccountClassHash: string;
}

export interface TransportExecutionResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly deployedWithTransaction: boolean;
}

interface TransportProvider {
  getClassHashAt(address: string, blockIdentifier: "latest"): Promise<string>;
  waitForTransaction(transactionHash: string): Promise<{
    isSuccess(): boolean;
    readonly block_number?: number;
  }>;
}

interface TransportAccount {
  readonly address: string;
  executePaymasterTransaction(
    calls: Call[],
    details: PaymasterDetails,
  ): Promise<{ readonly transaction_hash: string }>;
}

/**
 * Executes only a validated LayerSwap USDC funding action from a fresh S2.
 * There is deliberately no direct account.execute fallback: AVNU builds,
 * submits, and pays for the transaction so S2 needs no STRK.
 */
export class TransportAccountExecutor {
  constructor(
    private readonly provider: TransportProvider,
    private readonly account: TransportAccount,
    private readonly identity: DerivedPonsPrivacyIdentity,
    private readonly ozAccountClassHash: string,
  ) {}

  async executeFundingAction(
    action: LayerswapFundingAction,
  ): Promise<TransportExecutionResult> {
    const call = assertFundingCall(action);
    const deployed = await isDeployed(this.provider, this.account.address);
    const details: PaymasterDetails = {
      feeMode: { mode: "sponsored" },
      ...(!deployed
        ? {
            deploymentData: {
              address: this.account.address,
              class_hash: this.ozAccountClassHash,
              salt: this.identity.starknetPublicKey,
              calldata: [this.identity.starknetPublicKey],
              version: 1,
            },
          }
        : {}),
    };
    const submitted = await this.account.executePaymasterTransaction(
      [call],
      details,
    );
    const receipt = await this.provider.waitForTransaction(
      submitted.transaction_hash,
    );
    if (!receipt.isSuccess()) {
      throw new Error(
        `Starknet transport funding reverted: ${submitted.transaction_hash}`,
      );
    }
    if (receipt.block_number === undefined) {
      throw new Error("Starknet transport funding receipt has no block number");
    }
    return {
      transactionHash: submitted.transaction_hash,
      blockNumber: receipt.block_number,
      deployedWithTransaction: !deployed,
    };
  }
}

export function createTransportAccountExecutor(
  config: TransportAccountConfig,
  identity: DerivedPonsPrivacyIdentity,
): TransportAccountExecutor {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const paymaster = new PaymasterRpc({ nodeUrl: config.paymasterUrl });
  const account = new Account({
    provider,
    paymaster,
    address: requireStarknetAddress(
      identity.starknetAddress,
      "transportAccountAddress",
    ),
    signer: identity.starknetPrivateKey,
    cairoVersion: "1",
  });
  return new TransportAccountExecutor(
    provider,
    account,
    identity,
    requireStarknetAddress(config.ozAccountClassHash, "ozAccountClassHash"),
  );
}

export function isContractNotFoundError(error: unknown): boolean {
  if (error instanceof RpcError) return error.isType("CONTRACT_NOT_FOUND");
  const wrapped = error as
    | {
        readonly code?: unknown;
        readonly baseError?: { readonly code?: unknown };
      }
    | null
    | undefined;
  const code = wrapped?.code ?? wrapped?.baseError?.code;
  if (code === 20 || code === "20") return true;
  const message = (error as { readonly message?: unknown } | null)?.message;
  return typeof message === "string" && /contract not found/i.test(message);
}

async function isDeployed(
  provider: TransportProvider,
  address: string,
): Promise<boolean> {
  try {
    await provider.getClassHashAt(address, "latest");
    return true;
  } catch (error) {
    if (isContractNotFoundError(error)) return false;
    throw error;
  }
}

function assertFundingCall(action: LayerswapFundingAction): Call {
  if (action.network !== "STARKNET_MAINNET" || action.token !== "USDC") {
    throw new Error("transport action must be Starknet mainnet USDC");
  }
  if (BigInt(action.tokenAddress) !== BigInt(LAYERSWAP_STARKNET_USDC_ADDRESS)) {
    throw new Error("transport action token is not pinned Starknet USDC");
  }
  if (
    BigInt(action.call.contractAddress) !== BigInt(action.tokenAddress) ||
    action.call.entrypoint !== "transfer"
  ) {
    throw new Error(
      "transport action may call only the USDC transfer entrypoint",
    );
  }
  const [recipient, lowValue, highValue] = action.call.calldata;
  const low = BigInt(lowValue);
  const high = BigInt(highValue);
  if (
    BigInt(recipient) !== BigInt(action.recipient) ||
    low < 0n ||
    high < 0n ||
    low >= 1n << 128n ||
    high >= 1n << 128n ||
    low + (high << 128n) !== action.amount
  ) {
    throw new Error("transport action recipient or amount changed");
  }
  return {
    contractAddress: action.call.contractAddress,
    entrypoint: "transfer",
    calldata: [recipient, lowValue, highValue],
  };
}
