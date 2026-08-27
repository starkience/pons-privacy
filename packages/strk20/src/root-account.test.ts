import { describe, expect, it, vi } from "vitest";
import type { DerivedPonsPrivacyIdentity } from "@pons-privacy/sdk";
import { RootAccountDeployer } from "./root-account.js";

const CLASS_HASH = "0x123";
const identity: DerivedPonsPrivacyIdentity = {
  starknetPrivateKey: `0x${"11".repeat(32)}`,
  starknetPublicKey: "0x456",
  starknetAddress: "0x789",
  viewingKey: 12n,
};

function harness() {
  let deployed = false;
  const provider = {
    getClassHashAt: vi.fn(async () => {
      if (!deployed) throw new Error("Contract not found");
      return CLASS_HASH;
    }),
    waitForTransaction: vi.fn(async () => {
      deployed = true;
      return { isSuccess: () => true, block_number: 55 };
    }),
  };
  const account = {
    address: identity.starknetAddress,
    executePaymasterTransaction: vi.fn(async () => ({
      transaction_hash: "0xdeploy",
    })),
  };
  return {
    account,
    deployer: new RootAccountDeployer(provider, account, identity, CLASS_HASH),
    provider,
  };
}

describe("sponsored S1 deployment", () => {
  it("journals the hash before waiting and deploys with pinned OZ data", async () => {
    const { account, deployer } = harness();
    const onTransactionHash = vi.fn();
    await expect(
      deployer.ensureDeployed({ onTransactionHash }),
    ).resolves.toEqual({
      deployed: true,
      transactionHash: "0xdeploy",
      blockNumber: 55,
    });
    expect(account.executePaymasterTransaction).toHaveBeenCalledWith([], {
      feeMode: { mode: "sponsored" },
      deploymentData: {
        address: identity.starknetAddress,
        class_hash: CLASS_HASH,
        salt: identity.starknetPublicKey,
        calldata: [identity.starknetPublicKey],
        version: 1,
      },
    });
    expect(onTransactionHash).toHaveBeenCalledWith("0xdeploy");
  });

  it("reconciles a previous deployment hash without submitting another", async () => {
    const { account, deployer, provider } = harness();
    await expect(
      deployer.ensureDeployed({ previousTransactionHash: "0xprior" }),
    ).resolves.toMatchObject({
      deployed: true,
      transactionHash: "0xprior",
    });
    expect(provider.waitForTransaction).toHaveBeenCalledWith("0xprior");
    expect(account.executePaymasterTransaction).not.toHaveBeenCalled();
  });
});
