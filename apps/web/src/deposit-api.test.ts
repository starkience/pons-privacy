import { describe, expect, it, vi } from "vitest";
import {
  createDepositQuoteApi,
  formatUsdAmount,
  parseUsdAmount,
} from "./deposit-api.js";

describe("deposit quote API", () => {
  it("quotes the pinned Robinhood deposit route", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new URL(String(input), "https://pons.local");
      expect(request.pathname).toBe("/deposit-api/v1/deposits/quote");
      expect(request.searchParams.get("amount")).toBe("10000000");
      return new Response(
        JSON.stringify({
          provider: "layerswap",
          direction: "return-to-strk20",
          sourceNetwork: "ROBINHOOD_MAINNET",
          sourceAsset: "USDG",
          destinationNetwork: "STARKNET_MAINNET",
          destinationAsset: "USDC",
          amountIn: "10000000",
          expectedAmountOut: "9630000",
          minAmountOut: "9580000",
          feeAmount: "370000",
          expiresAt: 30_000,
          averageCompletionSeconds: 22.25,
          path: ["LAYERSWAP"],
        }),
      );
    });
    await expect(
      createDepositQuoteApi("/deposit-api/v1", fetchMock).quote(10_000_000n),
    ).resolves.toMatchObject({ expectedAmountOut: 9_630_000n });
  });
});

describe("USD amount helpers", () => {
  it("parses six-decimal stablecoin amounts exactly", () => {
    expect(parseUsdAmount("10.123456")).toBe(10_123_456n);
    expect(() => parseUsdAmount("1.1234567")).toThrow(/6 decimals/);
    expect(() => parseUsdAmount("0")).toThrow(/positive/);
  });

  it("formats stablecoin amounts without float rounding", () => {
    expect(formatUsdAmount(10_120_000n)).toBe("10.12");
    expect(formatUsdAmount(10_000_000n)).toBe("10");
  });
});
