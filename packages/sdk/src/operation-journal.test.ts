import { describe, expect, it } from "vitest";
import {
  PonsOperationJournal,
  type JournalStorage,
} from "./operation-journal.js";

const SIGNATURE = `0x${"11".repeat(65)}`;
const OTHER_SIGNATURE = `0x${"22".repeat(65)}`;
const S1 = "0x123";
const S2 = "0x456";
const R2 = "0x1111111111111111111111111111111111111111";

class MemoryStorage implements JournalStorage {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("encrypted privacy operation journal", () => {
  it("resumes an exit without storing addresses or secrets in clear text", async () => {
    const storage = new MemoryStorage();
    let now = 100;
    const journal = await PonsOperationJournal.open(SIGNATURE, {
      storage,
      now: () => now++,
    });
    const created = await journal.create({
      direction: "exit",
      accountIndex: 7,
      amount: 10_000_000n,
      rootStarknetAddress: S1,
      transportStarknetAddress: S2,
      robinhoodExecutionAddress: R2,
    });
    await journal.advance(created.id, "quote-ready", {
      quoteExpiresAt: 30_000,
    });
    await journal.advance(created.id, "swap-created", { swapId: "swap-7" });

    const persisted = [...storage.values.entries()].flat().join(" ");
    expect(persisted).not.toContain(S1);
    expect(persisted).not.toContain(S2);
    expect(persisted).not.toContain(R2);
    expect(persisted).not.toContain(SIGNATURE);
    expect(persisted).not.toContain("swap-7");

    const reopened = await PonsOperationJournal.open(SIGNATURE, { storage });
    await expect(reopened.list()).resolves.toMatchObject([
      { id: created.id, state: "swap-created", swapId: "swap-7" },
    ]);
  });

  it("separates journals by wallet signature", async () => {
    const storage = new MemoryStorage();
    const first = await PonsOperationJournal.open(SIGNATURE, { storage });
    await first.create({
      direction: "deposit",
      accountIndex: 0,
      amount: 1n,
      rootStarknetAddress: S1,
    });
    const second = await PonsOperationJournal.open(OTHER_SIGNATURE, {
      storage,
    });
    await expect(second.list()).resolves.toEqual([]);
    expect(storage.values.size).toBe(1);
  });

  it("rejects skipped states and the forbidden S1 outbound route", async () => {
    const storage = new MemoryStorage();
    const journal = await PonsOperationJournal.open(SIGNATURE, { storage });
    await expect(
      journal.create({
        direction: "exit",
        accountIndex: 1,
        amount: 1n,
        rootStarknetAddress: S1,
        transportStarknetAddress: S1,
        robinhoodExecutionAddress: R2,
      }),
    ).rejects.toThrow(/must differ/);
    const created = await journal.create({
      direction: "deposit",
      accountIndex: 2,
      amount: 1n,
      rootStarknetAddress: S1,
    });
    await expect(journal.advance(created.id, "private")).rejects.toThrow(
      /invalid deposit transition/,
    );
  });

  it("records retryable errors without losing the last stable state", async () => {
    const storage = new MemoryStorage();
    const journal = await PonsOperationJournal.open(SIGNATURE, { storage });
    const created = await journal.create({
      direction: "deposit",
      accountIndex: 3,
      amount: 1n,
      rootStarknetAddress: S1,
    });
    await journal.advance(created.id, "quote-ready");
    const failed = await journal.recordError(created.id, "provider timed out");
    expect(failed).toMatchObject({
      state: "quote-ready",
      lastError: "provider timed out",
    });
    const cleared = await journal.clearError(created.id);
    expect(cleared.lastError).toBeUndefined();
  });

  it("persists the exact inbound amount and relay recovery boundary encrypted", async () => {
    const storage = new MemoryStorage();
    const journal = await PonsOperationJournal.open(SIGNATURE, { storage });
    const created = await journal.create({
      direction: "deposit",
      accountIndex: 5,
      amount: 10_000_000n,
      rootStarknetAddress: S1,
    });
    await journal.advance(created.id, "quote-ready");
    await journal.advance(created.id, "swap-created", { swapId: "swap-5" });
    await journal.advance(created.id, "source-submitted");
    await journal.advance(created.id, "bridged-to-starknet", {
      destinationAmount: "9630000",
      destinationTxHash: "0xfunding",
    });
    await journal.advance(created.id, "shielding", {
      accountDeploymentTxHash: "0xdeploy",
      privateRelayStartedAt: 1234,
      privateTxHash: "0xprivate",
    });
    await expect(journal.list()).resolves.toMatchObject([
      {
        destinationAmount: "9630000",
        accountDeploymentTxHash: "0xdeploy",
        privateRelayStartedAt: 1234,
        privateTxHash: "0xprivate",
      },
    ]);
    const persisted = [...storage.values.values()].join(" ");
    expect(persisted).not.toContain("9630000");
    expect(persisted).not.toContain("0xprivate");
  });

  it("does not persist opaque provider payloads as recovery errors", async () => {
    const storage = new MemoryStorage();
    const journal = await PonsOperationJournal.open(SIGNATURE, { storage });
    const created = await journal.create({
      direction: "deposit",
      accountIndex: 4,
      amount: 1n,
      rootStarknetAddress: S1,
    });
    const failed = await journal.recordError(
      created.id,
      `prover rejected payload ${SIGNATURE}`,
    );
    expect(failed.lastError).toBe(
      "Operation paused; reconnect and resume safely.",
    );
    const reopened = await PonsOperationJournal.open(SIGNATURE, { storage });
    expect((await reopened.list())[0]?.lastError).not.toContain(SIGNATURE);
  });
});
