import { describe, expect, it, vi } from "vitest";
import { LayerswapQuoteClient } from "./layerswap.js";

const USDC = 1_000_000n;

function response(overrides: Partial<Record<string, unknown>> = {}): Response {
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
          path: [
            { provider: "LAYERSWAP", order: 0 },
            { provider: "JUPITER", order: 1 },
          ],
          ...overrides,
        },
      },
    }),
  );
}

describe("LayerSwap quote client", () => {
  it("pins the Robinhood USDG to Starknet USDC deposit route", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const request = new URL(url);
      expect(request.searchParams.get("source_network")).toBe(
        "ROBINHOOD_MAINNET",
      );
      expect(request.searchParams.get("source_token")).toBe("USDG");
      expect(request.searchParams.get("destination_network")).toBe(
        "STARKNET_MAINNET",
      );
      expect(request.searchParams.get("destination_token")).toBe("USDC");
      expect(request.searchParams.get("amount")).toBe("10");
      return response();
    });
    const client = new LayerswapQuoteClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: fetchMock,
      now: () => 1_000,
    });

    await expect(
      client.quote("return-to-strk20", 10n * USDC),
    ).resolves.toMatchObject({
      provider: "layerswap",
      direction: "return-to-strk20",
      amountIn: 10n * USDC,
      expectedAmountOut: 9_630_000n,
      minAmountOut: 9_580_000n,
      feeAmount: 370_000n,
      expiresAt: 31_000,
      averageCompletionSeconds: 22.25,
      path: ["LAYERSWAP", "JUPITER"],
    });
  });

  it("pins the Starknet USDC to Robinhood USDG funding route", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const request = new URL(url);
      expect(request.searchParams.get("source_network")).toBe(
        "STARKNET_MAINNET",
      );
      expect(request.searchParams.get("destination_network")).toBe(
        "ROBINHOOD_MAINNET",
      );
      return response({
        source_network: { name: "STARKNET_MAINNET" },
        source_token: { symbol: "USDC" },
        destination_network: { name: "ROBINHOOD_MAINNET" },
        destination_token: { symbol: "USDG" },
      });
    });
    const client = new LayerswapQuoteClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: fetchMock,
    });
    await expect(
      client.quote("fund-robinhood", 10n * USDC),
    ).resolves.toMatchObject({
      sourceNetwork: "STARKNET_MAINNET",
      sourceAsset: "USDC",
      destinationNetwork: "ROBINHOOD_MAINNET",
      destinationAsset: "USDG",
    });
  });

  it("rejects provider route drift", async () => {
    const client = new LayerswapQuoteClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: async () =>
        response({ destination_network: { name: "BASE_MAINNET" } }),
    });
    await expect(client.quote("return-to-strk20", 10n * USDC)).rejects.toThrow(
      /route mismatch/,
    );
  });

  it("surfaces LayerSwap API errors", async () => {
    const client = new LayerswapQuoteClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { message: "route unavailable" } }),
          { status: 400 },
        ),
    });
    await expect(client.quote("return-to-strk20", 10n * USDC)).rejects.toThrow(
      "route unavailable",
    );
  });
});
