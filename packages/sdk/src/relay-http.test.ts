import type { Address, Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createHttpRelay } from "./relay-http.js";
import { NO_RELAYER_FEE, type RelayExecutionRequest } from "./types.js";

const request: RelayExecutionRequest = {
  chainId: 4663,
  factory: "0x1111111111111111111111111111111111111111" as Address,
  account: "0x2222222222222222222222222222222222222222" as Address,
  owner: "0x3333333333333333333333333333333333333333" as Address,
  accountIndex: 1,
  calls: [
    {
      target: "0x4444444444444444444444444444444444444444" as Address,
      value: 5n,
      data: "0x1234" as Hex,
    },
  ],
  nonce: 0n,
  deadline: 1_900_000_000n,
  prefund: 5n,
  fee: NO_RELAYER_FEE,
  signature: "0x" as Hex,
};

describe("HTTP relay", () => {
  it("serializes bigint fields and returns a transaction hash", async () => {
    const transactionHash = `0x${"aa".repeat(32)}`;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.prefund).toBe("5");
      expect((body.calls as Array<Record<string, unknown>>)[0]?.value).toBe(
        "5",
      );
      return new Response(JSON.stringify({ transactionHash }), { status: 202 });
    });
    await expect(
      createHttpRelay({ endpoint: "/v1/relay", fetch: fetchMock })(request),
    ).resolves.toBe(transactionHash);
  });

  it("rejects insecure remote endpoints", () => {
    expect(() =>
      createHttpRelay({ endpoint: "http://example.com/v1/relay" }),
    ).toThrow(/must use HTTPS/);
  });
});
