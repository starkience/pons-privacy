import { describe, expect, it, vi } from "vitest";
import {
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  NO_RELAYER_FEE,
  layerswapReturnActionsToCalls,
  type LayerswapDepositAction,
  type LayerswapSwap,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";
import type { Address, Hex, PublicClient } from "viem";
import { validateExecutionPolicy } from "./execution-policy.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const FACTORY = "0x3333333333333333333333333333333333333333" as Address;
const RECIPIENT = "0x4444444444444444444444444444444444444444" as Address;
const SWAP_ID = "return-swap-1";

const action: LayerswapDepositAction = {
  type: "transfer",
  order: 0,
  network: "ROBINHOOD_MAINNET",
  token: "USDG",
  tokenAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  toAddress: RECIPIENT,
  amount: 30_000_000n,
};

const swap: LayerswapSwap = {
  id: SWAP_ID,
  createdAt: "2026-08-27T12:00:00Z",
  status: "user_transfer_pending",
  sourceAddress: ACCOUNT,
  destinationAddress: "0x123",
  amountIn: action.amount,
  useDepositAddress: false,
  transactions: [],
};

function request(): RelayExecutionRequest {
  return {
    chainId: 4663,
    factory: FACTORY,
    account: ACCOUNT,
    owner: OWNER,
    accountIndex: 1,
    calls: layerswapReturnActionsToCalls([action]),
    nonce: 0n,
    deadline: 1_900_000_000n,
    prefund: 0n,
    fee: NO_RELAYER_FEE,
    signature: "0x" as Hex,
    policyContext: { kind: "layerswap-return", swapId: SWAP_ID },
  };
}

describe("execution policy", () => {
  it("accepts only the exact live non-gasless R2 USDG return action", async () => {
    const gateway = {
      getSwap: vi.fn(async () => swap),
      getDepositActions: vi.fn(async () => [action]),
    };
    await expect(
      validateExecutionPolicy(request(), {} as PublicClient, gateway),
    ).resolves.toBeUndefined();
    expect(gateway.getDepositActions).toHaveBeenCalledWith(
      SWAP_ID,
      ACCOUNT,
      action.amount,
    );
  });

  it("rejects a signed return when LayerSwap changes the recipient", async () => {
    const gateway = {
      getSwap: vi.fn(async () => swap),
      getDepositActions: vi.fn(async () => [{ ...action, toAddress: OWNER }]),
    };
    await expect(
      validateExecutionPolicy(request(), {} as PublicClient, gateway),
    ).rejects.toThrow("changed from the live order");
  });

  it("rejects a return for a swap owned by another source account", async () => {
    const gateway = {
      getSwap: vi.fn(async () => ({ ...swap, sourceAddress: OWNER })),
      getDepositActions: vi.fn(async () => [action]),
    };
    await expect(
      validateExecutionPolicy(request(), {} as PublicClient, gateway),
    ).rejects.toThrow("not pending for this R2 account");
    expect(gateway.getDepositActions).not.toHaveBeenCalled();
  });
});
