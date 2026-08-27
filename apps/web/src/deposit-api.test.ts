import { describe, expect, it, vi } from "vitest";
import {
  createDepositQuoteApi,
  formatUsdAmount,
  parseUsdAmount,
} from "./deposit-api.js";
import { LAYERSWAP_STARKNET_USDC_ADDRESS } from "@pons-privacy/sdk";

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

  it("quotes and recovers the pinned S2 funding action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new URL(String(input), "https://pons.local");
      if (request.pathname.endsWith("/funding/quote")) {
        return new Response(
          JSON.stringify({
            provider: "layerswap",
            direction: "fund-robinhood",
            sourceNetwork: "STARKNET_MAINNET",
            sourceAsset: "USDC",
            destinationNetwork: "ROBINHOOD_MAINNET",
            destinationAsset: "USDG",
            amountIn: "10000000",
            expectedAmountOut: "9630000",
            minAmountOut: "9580000",
            feeAmount: "370000",
            expiresAt: 30_000,
            averageCompletionSeconds: 22.25,
            path: ["LAYERSWAP"],
          }),
        );
      }
      expect(request.pathname).toContain(
        "/funding/swaps/swap-1/deposit-action",
      );
      return new Response(
        JSON.stringify({
          swap: {
            id: "swap-1",
            status: "user_transfer_pending",
            amountIn: "10000000",
            sourceAddress: "0x456",
            destinationAddress: "0x2222222222222222222222222222222222222222",
            transactions: [],
          },
          action: {
            type: "transfer",
            order: 0,
            network: "STARKNET_MAINNET",
            token: "USDC",
            tokenAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
            amount: "10000000",
            recipient: "0x987",
            call: {
              contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
              entrypoint: "transfer",
              calldata: ["0x987", "10000000", "0"],
            },
          },
        }),
      );
    });
    const api = createDepositQuoteApi("/deposit-api/v1", fetchMock);
    await expect(api.quoteFunding!(10_000_000n)).resolves.toMatchObject({
      direction: "fund-robinhood",
    });
    await expect(
      api.getFundingAction!("swap-1", "0x456", 10_000_000n),
    ).resolves.toMatchObject({ recipient: "0x987", amount: 10_000_000n });
  });

  it("uses LayerSwap's actual output transaction amount for shielding", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "swap-1",
            status: "completed",
            amountIn: "10000000",
            sourceAddress: "0x1111111111111111111111111111111111111111",
            destinationAddress: "0x456",
            transactions: [
              {
                type: "output",
                status: "completed",
                transactionHash: "0xfunding",
                amount: "9630000",
              },
            ],
          }),
        ),
    );
    const api = createDepositQuoteApi("/deposit-api/v1", fetchMock);
    await expect(
      api.getDepositSwap!(
        "swap-1",
        "0x1111111111111111111111111111111111111111",
      ),
    ).resolves.toMatchObject({
      outputTransactionHash: "0xfunding",
      outputAmount: 9_630_000n,
    });
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
