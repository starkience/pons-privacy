import { describe, expect, it, vi } from "vitest";
import {
  WarningCode,
  type Note,
  type PrivateTransfersInterface,
} from "@starkware-libs/starknet-privacy-sdk";
import type { Account, RpcProvider } from "starknet";
import { Strk20Custodian, selectMatureNotes } from "./custodian.js";

const USDC =
  "0x0000000000000000000000000000000000000000000000000000000000000abc";

function note(amount: bigint, created?: number): Note {
  return {
    id: amount,
    amount,
    sender: 1n,
    witness: {} as Note["witness"],
    ...(created === undefined ? {} : { created }),
  };
}

describe("mature note selection", () => {
  it("uses only notes mature at the proving block", () => {
    const selection = selectMatureNotes(
      [note(30n, 80), note(50n, 95), note(40n, 89)],
      60n,
      100,
    );
    expect(selection.selected.map((item) => item.amount)).toEqual([30n, 40n]);
    expect(selection.selectedAmount).toBe(70n);
    expect(selection.privateBalance).toBe(120n);
    expect(selection.matureBalance).toBe(70n);
  });

  it("fails closed when only immature or timestamp-less notes cover the amount", () => {
    expect(() =>
      selectMatureNotes([note(50n, 95), note(50n)], 10n, 100),
    ).toThrow("insufficient mature STRK20 balance");
  });
});

describe("project-held withdrawal", () => {
  function harness(warnings: Array<{ code: WarningCode; message: string }>) {
    const tokenBuilder = {
      inputs: vi.fn().mockReturnThis(),
      withdraw: vi.fn().mockReturnThis(),
    };
    const invocation = { warnings, invocation: {}, registry: {} };
    const builder = {
      with: vi.fn(
        (_token: string, callback: (value: typeof tokenBuilder) => void) => {
          callback(tokenBuilder);
          return builder;
        },
      ),
      surplusTo: vi.fn().mockReturnThis(),
      createProofInvocation: vi.fn().mockResolvedValue(invocation),
    };
    const transfers = {
      discoverNotes: vi.fn().mockResolvedValue({
        timestamp: 100,
        notes: new Map([[BigInt(USDC), [note(100n, 70)]]]),
      }),
      build: vi.fn().mockReturnValue(builder),
      executeWithInvocation: vi.fn().mockResolvedValue({
        warnings,
        registry: {},
        callAndProof: {
          call: { contractAddress: "0x1", entrypoint: "apply_actions" },
          proof: { data: "proof", output: [], proofFacts: [] },
        },
      }),
      invalidateProofNonceCache: vi.fn(),
    };
    const provider = {
      getBlockNumber: vi.fn().mockResolvedValue(100),
      waitForTransaction: vi.fn().mockResolvedValue({
        isSuccess: () => true,
        block_number: 101,
      }),
    };
    const account = {
      address: "0x123",
      execute: vi.fn().mockResolvedValue({ transaction_hash: "0xfeed" }),
    };
    const custodian = new Strk20Custodian(
      provider as unknown as RpcProvider,
      account as unknown as Account,
      transfers as unknown as PrivateTransfersInterface,
      USDC,
    );
    return { account, builder, custodian, invocation, provider, transfers };
  }

  it("stops linkage warnings before requesting a proof", async () => {
    const { account, custodian, transfers } = harness([
      { code: WarningCode.USER_LINKAGE, message: "linkage" },
    ]);
    await expect(
      custodian.withdraw({
        amount: 10n,
        recipient: "0x456",
        allowUserLinkageWarning: false,
      }),
    ).rejects.toThrow("USER_LINKAGE");
    expect(transfers.executeWithInvocation).not.toHaveBeenCalled();
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("withdraws only configured USDC and submits proof facts", async () => {
    const { account, custodian, invocation, transfers } = harness([]);
    const result = await custodian.withdraw({
      amount: 10n,
      recipient: "0x0456",
      allowUserLinkageWarning: false,
    });
    expect(transfers.discoverNotes).toHaveBeenCalledWith({
      tokens: [BigInt(USDC)],
      blockIdentifier: 90,
    });
    expect(transfers.executeWithInvocation).toHaveBeenCalledWith(
      invocation,
      90,
    );
    expect(account.execute).toHaveBeenCalledWith(expect.anything(), {
      tip: 0n,
      proofFacts: [],
      proof: "proof",
    });
    expect(result.token).toBe(USDC);
    expect(result.recipient).toMatch(/0456$/);
  });
});
