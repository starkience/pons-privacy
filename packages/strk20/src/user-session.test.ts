import { describe, expect, it, vi } from "vitest";
import {
  WarningCode,
  type Note,
  type PrivateTransfersInterface,
} from "@starkware-libs/starknet-privacy-sdk";
import type { Account, RpcProvider } from "starknet";
import type { PrivatePaymasterGateway } from "./private-paymaster.js";
import { UserStrk20Session, selectMatureNotes } from "./user-session.js";

const USDC =
  "0x0000000000000000000000000000000000000000000000000000000000000abc";
const POOL = "0x999";

function note(amount: bigint, created?: number): Note {
  return {
    id: amount,
    amount,
    sender: 1n,
    witness: {} as Note["witness"],
    ...(created === undefined ? {} : { created }),
  };
}

function harness(warnings: Array<{ code: WarningCode; message: string }> = []) {
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
        call: {
          contractAddress: POOL,
          entrypoint: "apply_actions",
          calldata: ["1"],
        },
        proof: { data: "0x2", output: [], proofFacts: ["0x3"] },
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
  const account = { address: "0x123", execute: vi.fn() };
  const paymaster: PrivatePaymasterGateway = {
    buildPoolAction: vi.fn().mockResolvedValue({
      parameters: {
        version: "0x1",
        fee_mode: {
          mode: "sponsored_private",
          pool_fee_token: USDC,
        },
      },
      feeAction: {
        type: "withdraw",
        recipient: "0x777",
        token: USDC,
        amount: 3n,
      },
    }),
    executePoolAction: vi.fn().mockResolvedValue({
      transactionHash: "0xfeed",
      trackingId: "track-1",
    }),
  };
  const session = new UserStrk20Session(
    provider as unknown as RpcProvider,
    account as unknown as Account,
    transfers as unknown as PrivateTransfersInterface,
    paymaster,
    POOL,
    USDC,
    10n,
  );
  return {
    account,
    invocation,
    paymaster,
    session,
    tokenBuilder,
    transfers,
  };
}

describe("mature note selection", () => {
  it("uses only notes mature at the proving block", () => {
    const selection = selectMatureNotes(
      [note(30n, 80), note(50n, 95), note(40n, 79)],
      60n,
      100,
    );
    expect(selection.selected.map((item) => item.amount)).toEqual([30n, 40n]);
    expect(selection.matureBalance).toBe(70n);
  });
});

describe("user-controlled STRK20 outbound", () => {
  it("withdraws to fresh S2, includes the private fee, and never calls S1.execute", async () => {
    const { account, invocation, paymaster, session, tokenBuilder, transfers } =
      harness();
    await expect(
      session.withdrawToTransport({
        amount: 10n,
        transportAccountAddress: "0x456",
      }),
    ).resolves.toMatchObject({
      transactionHash: "0xfeed",
      amount: 10n,
      poolFee: 3n,
    });
    expect(tokenBuilder.withdraw).toHaveBeenNthCalledWith(1, {
      recipient: expect.stringMatching(/0456$/),
      amount: 10n,
    });
    expect(tokenBuilder.withdraw).toHaveBeenNthCalledWith(2, {
      recipient: "0x777",
      amount: 3n,
    });
    expect(transfers.executeWithInvocation).toHaveBeenCalledWith(
      invocation,
      90,
    );
    expect(paymaster.executePoolAction).toHaveBeenCalledWith(
      expect.objectContaining({ poolAddress: POOL, proof: "0x2" }),
    );
    expect(account.execute).not.toHaveBeenCalled();
  });

  it("rejects S1 as the transport recipient before proving or submitting", async () => {
    const { paymaster, session, transfers } = harness();
    await expect(
      session.withdrawToTransport({
        amount: 10n,
        transportAccountAddress: "0x123",
      }),
    ).rejects.toThrow("must not initiate the outbound bridge");
    expect(paymaster.buildPoolAction).not.toHaveBeenCalled();
    expect(transfers.executeWithInvocation).not.toHaveBeenCalled();
  });

  it("stops a USER_LINKAGE warning before producing or submitting a proof", async () => {
    const { paymaster, session, transfers } = harness([
      { code: WarningCode.USER_LINKAGE, message: "linkage" },
    ]);
    await expect(
      session.withdrawToTransport({
        amount: 10n,
        transportAccountAddress: "0x456",
      }),
    ).rejects.toThrow("USER_LINKAGE");
    expect(transfers.executeWithInvocation).not.toHaveBeenCalled();
    expect(paymaster.executePoolAction).not.toHaveBeenCalled();
  });

  it("rejects a private-paymaster fee above the configured user cap", async () => {
    const { paymaster, session, transfers } = harness();
    vi.mocked(paymaster.buildPoolAction).mockResolvedValueOnce({
      parameters: {
        version: "0x1",
        fee_mode: {
          mode: "sponsored_private",
          pool_fee_token: USDC,
        },
      },
      feeAction: {
        type: "withdraw",
        recipient: "0x777",
        token: USDC,
        amount: 11n,
      },
    });
    await expect(
      session.withdrawToTransport({
        amount: 10n,
        transportAccountAddress: "0x456",
      }),
    ).rejects.toThrow("exceeds the configured maximum");
    expect(transfers.discoverNotes).not.toHaveBeenCalled();
    expect(paymaster.executePoolAction).not.toHaveBeenCalled();
  });
});
