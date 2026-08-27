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
      expect(request.searchParams.get("source_network")).toBe(
        "ROBINHOOD_MAINNET",
      );
      expect(request.searchParams.get("source_token")).toBe("USDG");
      expect(request.searchParams.get("destination_network")).toBe(
        "STARKNET_MAINNET",
      );
      expect(request.searchParams.get("destination_token")).toBe("USDC");
      return new Response(
        JSON.stringify({
          error: null,
          data: {
            quote: {
              source_network: { name: "ROBINHOOD_MAINNET" },
              source_token: { symbol: "USDG" },
              destination_network: { name: "STARKNET_MAINNET" },
              destination_token: { symbol: "USDC" },
              requested_amount: 10,
              receive_amount: 9.63,
              min_receive_amount: 9.58,
              total_fee: 0.37,
              avg_completion_time: "00:00:22.25",
              path: [{ provider: "LAYERSWAP", order: 0 }],
            },
          },
        }),
      );
    });
    await expect(
      createDepositQuoteApi("/layerswap-api/api/v2", fetchMock).quote(
        10_000_000n,
      ),
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
