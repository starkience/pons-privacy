import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  erc20Abi,
  ponsPrivacyAccountAbi,
  ponsPrivacyAccountFactoryAbi,
} from "./abi.js";
import {
  ponsV2Adapter,
  type PonsV2BuyIntent,
  type PonsV2SellIntent,
} from "./adapters/pons-v2.js";
import {
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "./chains/robinhood.js";
import { signExecution } from "./execution.js";
import {
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  type LayerswapDepositAction,
} from "./layerswap.js";
import {
  NO_RELAYER_FEE,
  type ExecutionCall,
  type RelayExecutionRequest,
} from "./types.js";
import type { ResolvedPonsPrivacyRoute } from "./identity.js";

const DEFAULT_DEADLINE_SECONDS = 10 * 60;

export type PonsTradeIntent =
  | { readonly side: "buy"; readonly value: PonsV2BuyIntent }
  | { readonly side: "sell"; readonly value: PonsV2SellIntent };

export async function preparePonsTradeRelayRequest(args: {
  readonly route: ResolvedPonsPrivacyRoute;
  readonly accountIndex: number;
  readonly intent: PonsTradeIntent;
  readonly publicClient: PublicClient;
  readonly deadlineSeconds?: number;
  readonly now?: () => number;
}): Promise<RelayExecutionRequest> {
  const adapter = ponsV2Adapter();
  const calls =
    args.intent.side === "buy"
      ? await adapter.buildOpenCalls(args.intent.value, {
          account: args.route.robinhoodExecutionAccount,
          publicClient: args.publicClient,
        })
      : await adapter.buildCloseCalls(args.intent.value, {
          account: args.route.robinhoodExecutionAccount,
          publicClient: args.publicClient,
        });
  return prepareRouteExecution({ ...args, calls });
}

export async function prepareLayerswapReturnRelayRequest(args: {
  readonly route: ResolvedPonsPrivacyRoute;
  readonly accountIndex: number;
  readonly swapId: string;
  readonly actions: readonly LayerswapDepositAction[];
  readonly publicClient: PublicClient;
  readonly deadlineSeconds?: number;
  readonly now?: () => number;
}): Promise<RelayExecutionRequest> {
  if (!args.swapId.trim() || args.swapId.length > 128) {
    throw new Error("LayerSwap swapId must be a bounded identifier");
  }
  const request = await prepareRouteExecution({
    ...args,
    calls: layerswapReturnActionsToCalls(args.actions),
  });
  return {
    ...request,
    policyContext: { kind: "layerswap-return", swapId: args.swapId },
  };
}

/** Converts only the pinned non-gasless LayerSwap USDG action shape. */
export function layerswapReturnActionsToCalls(
  actions: readonly LayerswapDepositAction[],
): readonly ExecutionCall[] {
  if (actions.length !== 1) {
    throw new Error("LayerSwap return requires exactly one deposit action");
  }
  const action = actions[0]!;
  if (
    action.order !== 0 ||
    action.type === "sign" ||
    action.network !== "ROBINHOOD_MAINNET" ||
    action.token !== "USDG" ||
    getAddress(action.tokenAddress) !==
      getAddress(LAYERSWAP_ROBINHOOD_USDG_ADDRESS) ||
    action.amount <= 0n
  ) {
    throw new Error("LayerSwap return action changed the pinned USDG route");
  }
  if (action.callData) {
    let decoded: ReturnType<typeof decodeFunctionData<typeof erc20Abi>>;
    try {
      decoded = decodeFunctionData({ abi: erc20Abi, data: action.callData });
    } catch {
      throw new Error("LayerSwap return calldata is not an ERC20 transfer");
    }
    if (
      decoded.functionName !== "transfer" ||
      !isAddressEqual(action.toAddress, action.tokenAddress) ||
      BigInt(decoded.args[0]) === 0n ||
      decoded.args[1] !== action.amount
    ) {
      throw new Error("LayerSwap return calldata changed the USDG transfer");
    }
  }
  return [
    {
      target: getAddress(action.tokenAddress),
      value: 0n,
      data:
        action.callData ??
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(action.toAddress), action.amount],
        }),
    },
  ];
}

async function prepareRouteExecution(args: {
  readonly route: ResolvedPonsPrivacyRoute;
  readonly accountIndex: number;
  readonly calls: readonly ExecutionCall[];
  readonly publicClient: PublicClient;
  readonly deadlineSeconds?: number;
  readonly now?: () => number;
}): Promise<RelayExecutionRequest> {
  if (!Number.isSafeInteger(args.accountIndex) || args.accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  if (args.calls.length === 0) throw new Error("execution calls are required");
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
  const deadlineSeconds = args.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
  if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error("deadlineSeconds must be a positive safe integer");
  }
  const deadline = BigInt(
    Math.floor((args.now ?? Date.now)() / 1_000) + deadlineSeconds,
  );
  const request = {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    factory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
    account: args.route.robinhoodExecutionAccount,
    owner: owner.address,
    accountIndex: args.accountIndex,
    calls: [...args.calls],
    nonce,
    deadline,
    prefund: 0n,
    fee: NO_RELAYER_FEE,
  } as const;
  return {
    ...request,
    signature: await signExecution({
      privateKey: args.route.robinhoodExecution.privateKey,
      ...request,
    }),
  };
}
