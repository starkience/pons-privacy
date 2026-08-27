import { getAddress, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ponsPrivacyAccountAbi, ponsPrivacyAccountFactoryAbi } from "./abi.js";
import { ponsV2Adapter, type PonsV2LaunchIntent } from "./adapters/pons-v2.js";
import {
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "./chains/robinhood.js";
import { signExecution } from "./execution.js";
import type { ResolvedPonsPrivacyRoute } from "./identity.js";
import {
  NO_RELAYER_FEE,
  type RelayExecutionRequest,
  type RelayerFee,
} from "./types.js";

const DEFAULT_DEADLINE_SECONDS = 10 * 60;

export interface PreparePonsLaunchRequestArgs {
  readonly route: ResolvedPonsPrivacyRoute;
  readonly accountIndex: number;
  readonly intent: PonsV2LaunchIntent;
  readonly publicClient: PublicClient;
  readonly fee?: RelayerFee;
  readonly deadlineSeconds?: number;
  readonly now?: () => number;
}

/**
 * Builds and signs a Pons-only R2 launch request without exposing O2. The
 * caller may serialize the result, but must never serialize `route` itself.
 */
export async function preparePonsLaunchRelayRequest(
  args: PreparePonsLaunchRequestArgs,
): Promise<RelayExecutionRequest> {
  if (!Number.isSafeInteger(args.accountIndex) || args.accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  const deadlineSeconds = args.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error("deadlineSeconds must be a positive safe integer");
  }
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(args.intent.salt) ||
    BigInt(args.intent.salt) === 0n
  ) {
    throw new Error("Pons launch salt must be non-zero bytes32");
  }

  const owner = privateKeyToAccount(args.route.robinhoodExecution.privateKey);
  if (
    getAddress(owner.address) !==
    getAddress(args.route.robinhoodExecution.address)
  ) {
    throw new Error("derived O2 key does not match its owner address");
  }
  const predicted = await args.publicClient.readContract({
    address: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
    abi: ponsPrivacyAccountFactoryAbi,
    functionName: "computeAddress",
    args: [owner.address, BigInt(args.accountIndex)],
  });
  if (
    getAddress(predicted) !== getAddress(args.route.robinhoodExecutionAccount)
  ) {
    throw new Error("R2 does not match the deployed factory owner/index");
  }

  const calls = await ponsV2Adapter().buildLaunchCalls(args.intent, {
    account: args.route.robinhoodExecutionAccount,
    publicClient: args.publicClient,
  });
  const prefund = calls.reduce((total, call) => total + call.value, 0n);
  const code = await args.publicClient.getBytecode({
    address: args.route.robinhoodExecutionAccount,
  });
  const nonce = code
    ? await args.publicClient.readContract({
        address: args.route.robinhoodExecutionAccount,
        abi: ponsPrivacyAccountAbi,
        functionName: "nonce",
      })
    : 0n;
  const fee = args.fee ?? NO_RELAYER_FEE;
  const deadline = BigInt(
    Math.floor((args.now ?? Date.now)() / 1_000) + deadlineSeconds,
  );
  const request = {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    factory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
    account: args.route.robinhoodExecutionAccount,
    owner: owner.address,
    accountIndex: args.accountIndex,
    calls: [...calls],
    nonce,
    deadline,
    prefund,
    fee,
  } as const;
  return {
    ...request,
    signature: await signExecution({
      privateKey: args.route.robinhoodExecution.privateKey,
      ...request,
    }),
  };
}
