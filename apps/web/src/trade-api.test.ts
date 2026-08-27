import { describe, expect, it, vi } from "vitest";
import { createTradeApi } from "./trade-api.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const CURVE = "0x4444444444444444444444444444444444444444";

describe("private trade API", () => {
  it("serializes base units exactly and parses a reviewed buy", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          side: "buy",
          token: TOKEN,
          amount: "30000000",
          slippageBps: 300,
          account: ACCOUNT,
          owner: OWNER,
          accountIndex: 7,
        });
        return new Response(
          JSON.stringify({
            previewId: "d36f7e90-4d3f-4c5b-9f52-a55e39ce9d55",
            expiresAt: "2026-08-27T22:00:00.000Z",
            side: "buy",
            account: ACCOUNT,
            owner: OWNER,
            accountIndex: 7,
            token: TOKEN,
            curve: CURVE,
            tokenSymbol: "PONS",
            tokenDecimals: 18,
            amountIn: "30000000",
            expectedAmountOut: "9000000000000000000",
            minimumAmountOut: "8730000000000000000",
            slippageBps: 300,
          }),
        );
      },
    );
    await expect(
      createTradeApi("/api", fetchMock).preview({
        side: "buy",
        token: TOKEN,
        amount: 30_000_000n,
        slippageBps: 300,
        account: { account: ACCOUNT, owner: OWNER, accountIndex: 7 },
      }),
    ).resolves.toMatchObject({
      amountIn: 30_000_000n,
      expectedAmountOut: 9_000_000_000_000_000_000n,
    });
  });

  it("parses the exact post-trade balances used by the sell return", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "success",
            transactionHash: `0x${"55".repeat(32)}`,
            position: {
              account: ACCOUNT,
              token: TOKEN,
              curve: CURVE,
              tokenSymbol: "PONS",
              tokenDecimals: 18,
              tokenBalance: "0",
              usdgBalance: "29700000",
            },
          }),
        ),
    );
    await expect(
      createTradeApi("/api", fetchMock).status(
        `0x${"55".repeat(32)}`,
        ACCOUNT,
        TOKEN,
      ),
    ).resolves.toMatchObject({
      status: "success",
      position: { tokenBalance: 0n, usdgBalance: 29_700_000n },
    });
  });
});
