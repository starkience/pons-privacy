import {
  hashExecutionCalls,
  layerswapReturnActionsToCalls,
  type LayerswapDepositAction,
  type LayerswapSwap,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";
import { isAddressEqual, type Address, type PublicClient } from "viem";
import { validatePonsV2Calls } from "./pons-v2-policy.js";

export interface LayerswapReturnPolicyGateway {
  getSwap(swapId: string): Promise<LayerswapSwap>;
  getDepositActions(
    swapId: string,
    sourceAddress: Address,
    expectedAmount: bigint,
  ): Promise<readonly LayerswapDepositAction[]>;
}

export async function validateExecutionPolicy(
  request: RelayExecutionRequest,
  publicClient: PublicClient,
  layerswap?: LayerswapReturnPolicyGateway,
): Promise<void> {
  if (!request.policyContext) {
    await validatePonsV2Calls(request, publicClient);
    return;
  }
  if (request.policyContext.kind !== "layerswap-return" || !layerswap) {
    throw new Error("LayerSwap return relay policy is unavailable");
  }
  if (
    request.prefund !== 0n ||
    request.calls.some((call) => call.value !== 0n)
  ) {
    throw new Error("LayerSwap return must not use native value");
  }
  const swap = await layerswap.getSwap(request.policyContext.swapId);
  if (
    swap.status !== "user_transfer_pending" ||
    swap.useDepositAddress ||
    !swap.sourceAddress ||
    !isAddressEqual(swap.sourceAddress, request.account)
  ) {
    throw new Error("LayerSwap return is not pending for this R2 account");
  }
  const actions = await layerswap.getDepositActions(
    request.policyContext.swapId,
    request.account,
    swap.amountIn,
  );
  const expected = layerswapReturnActionsToCalls(actions);
  if (hashExecutionCalls(expected) !== hashExecutionCalls(request.calls)) {
    throw new Error(
      "signed LayerSwap return calls changed from the live order",
    );
  }
}
