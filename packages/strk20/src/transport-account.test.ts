import { describe, expect, it, vi } from "vitest";
import type {
  DerivedPonsPrivacyIdentity,
  LayerswapFundingAction,
} from "@pons-privacy/sdk";
import { LAYERSWAP_STARKNET_USDC_ADDRESS } from "@pons-privacy/sdk";
import {
  TransportAccountExecutor,
  isContractNotFoundError,
} from "./transport-account.js";

const identity: DerivedPonsPrivacyIdentity = {
  starknetPrivateKey: `0x${"11".repeat(32)}`,
  starknetPublicKey: "0x123",
  starknetAddress: "0x456",
  viewingKey: 789n,
};

const action: LayerswapFundingAction = {
  type: "transfer",
  order: 0,
  network: "STARKNET_MAINNET",
  token: "USDC",
  tokenAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
  amount: 10_000_000n,
  recipient: "0xdef",
  call: {
    contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    entrypoint: "transfer",
    calldata: ["0xdef", "10000000", "0"],
  },
};

function harness(deployed: boolean) {
  const provider = {
    getClassHashAt: deployed
      ? vi.fn(async () => "0x111")
      : vi.fn(async () => {
          throw Object.assign(new Error("Contract not found"), { code: 20 });
        }),
    waitForTransaction: vi.fn(async () => ({
      isSuccess: () => true,
      block_number: 321,
    })),
  };
  const account = {
    address: identity.starknetAddress,
    executePaymasterTransaction: vi.fn(async () => ({
      transaction_hash: "0xbeef",
    })),
  };
  const executor = new TransportAccountExecutor(
    provider,
    account,
    identity,
    "0xcafe",
  );
  return { account, executor, provider };
}

describe("fresh Starknet transport account", () => {
  it("atomically deploys an absent S2 and funds LayerSwap through the paymaster", async () => {
    const { account, executor } = harness(false);
    await expect(executor.executeFundingAction(action)).resolves.toEqual({
      transactionHash: "0xbeef",
      blockNumber: 321,
      deployedWithTransaction: true,
    });
    expect(account.executePaymasterTransaction).toHaveBeenCalledWith(
      [action.call],
      {
        feeMode: { mode: "sponsored" },
        deploymentData: {
          address: identity.starknetAddress,
          class_hash: "0xcafe",
          salt: identity.starknetPublicKey,
          calldata: [identity.starknetPublicKey],
          version: 1,
        },
      },
    );
  });

  it("does not redeploy an existing transport account", async () => {
    const { account, executor } = harness(true);
    await executor.executeFundingAction(action);
    expect(account.executePaymasterTransaction).toHaveBeenCalledWith(
      [action.call],
      { feeMode: { mode: "sponsored" } },
    );
  });

  it("rejects a modified amount before asking the paymaster to sign", async () => {
    const { account, executor } = harness(true);
    await expect(
      executor.executeFundingAction({ ...action, amount: 9_000_000n }),
    ).rejects.toThrow("recipient or amount changed");
    expect(account.executePaymasterTransaction).not.toHaveBeenCalled();
  });

  it("fails closed on ambiguous deployment reads", async () => {
    const { account, executor, provider } = harness(true);
    provider.getClassHashAt.mockRejectedValueOnce(new Error("RPC timeout"));
    await expect(executor.executeFundingAction(action)).rejects.toThrow(
      "RPC timeout",
    );
    expect(account.executePaymasterTransaction).not.toHaveBeenCalled();
  });

  it("recognizes only an explicit contract-not-found condition", () => {
    expect(isContractNotFoundError({ code: 20 })).toBe(true);
    expect(isContractNotFoundError(new Error("contract not found"))).toBe(true);
    expect(isContractNotFoundError(new Error("timeout"))).toBe(false);
  });
});
