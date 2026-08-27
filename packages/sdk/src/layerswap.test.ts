import { describe, expect, it, vi } from "vitest";
import {
  LayerswapClient,
  LayerswapQuoteClient,
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  LAYERSWAP_STARKNET_USDC_ADDRESS,
} from "./layerswap.js";

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

  it("reads exact six-decimal route limits", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const request = new URL(url);
      expect(request.pathname).toBe("/api/v2/limits");
      expect(request.searchParams.get("use_gasless")).toBe("false");
      return new Response(
        JSON.stringify({
          error: null,
          data: { min_amount: 0.480313, max_amount: 242 },
        }),
      );
    });
    const client = new LayerswapQuoteClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: fetchMock,
    });
    await expect(client.limits("return-to-strk20")).resolves.toEqual({
      direction: "return-to-strk20",
      minAmount: 480_313n,
      maxAmount: 242_000_000n,
    });
  });
});

const SOURCE = "0x1111111111111111111111111111111111111111";
const DESTINATION =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const DEPOSIT_TO = "0x2222222222222222222222222222222222222222";
const SWAP_ID = "16692477-6f05-4d6e-aa30-4b2dd753c63d";
const REFERENCE_ID = "2ae8a244-9908-4c8e-924d-e6cbe842b325";

function preparedSwap(
  actionOverrides: Partial<Record<string, unknown>> = {},
): Response {
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
        swap: {
          id: SWAP_ID,
          created_date: "2026-08-27T12:00:00Z",
          source_network: { name: "ROBINHOOD_MAINNET" },
          source_token: {
            symbol: "USDG",
            contract: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
            decimals: 6,
          },
          destination_network: { name: "STARKNET_MAINNET" },
          destination_token: {
            symbol: "USDC",
            contract: LAYERSWAP_STARKNET_USDC_ADDRESS,
            decimals: 6,
          },
          requested_amount: 10,
          destination_address: DESTINATION,
          source_address: SOURCE,
          status: "user_transfer_pending",
          fail_reason: null,
          use_deposit_address: false,
          metadata: { sequence_number: 1, reference_id: REFERENCE_ID },
          transactions: [],
        },
        deposit_actions: [
          {
            type: "transfer",
            order: 0,
            network: { name: "ROBINHOOD_MAINNET" },
            token: {
              symbol: "USDG",
              contract: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
              decimals: 6,
            },
            fee_token: { symbol: "ETH" },
            to_address: DEPOSIT_TO,
            amount: 10,
            amount_in_base_units: "10000000",
            call_data: "0x1234",
            ...actionOverrides,
          },
        ],
      },
    }),
  );
}

describe("authenticated LayerSwap client", () => {
  it("creates a funding swap from a fresh Starknet transport account", async () => {
    const transportSource = DESTINATION;
    const robinhoodDestination = SOURCE;
    const fundingRecipient =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        source_network: "STARKNET_MAINNET",
        source_token: "USDC",
        destination_network: "ROBINHOOD_MAINNET",
        destination_token: "USDG",
        source_address: transportSource,
        destination_address: robinhoodDestination,
        refund_address: transportSource,
        use_deposit_address: false,
      });
      return fundingPreparedSwap(fundingRecipient);
    });
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: fetchMock,
    });

    await expect(
      client.createFundingSwap({
        amountIn: 10n * USDC,
        sourceAddress: transportSource,
        destinationAddress: robinhoodDestination,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({
      swap: {
        sourceAddress: transportSource.toLowerCase(),
        destinationAddress: robinhoodDestination,
      },
      depositAction: {
        token: "USDC",
        amount: 10n * USDC,
        recipient: fundingRecipient,
        call: {
          contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
          entrypoint: "transfer",
          calldata: [fundingRecipient, "10000000", "0"],
        },
      },
    });
  });

  it("rejects a funding action with an extra or substituted Starknet call", async () => {
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: async () =>
        fundingPreparedSwap("0x123", [
          starknetTransferCall("0x123"),
          starknetTransferCall("0x456"),
        ]),
    });
    await expect(
      client.createFundingSwap({
        amountIn: 10n * USDC,
        sourceAddress: DESTINATION,
        destinationAddress: SOURCE,
        referenceId: REFERENCE_ID,
      }),
    ).rejects.toThrow(/exactly one Starknet call/);
  });

  it("re-fetches the exact funding action so an S2 exit can resume", async () => {
    const recipient = "0x123";
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain(`/swaps/${REFERENCE_ID}/deposit_actions`);
      expect(url).toContain(
        `source_address=${encodeURIComponent(DESTINATION)}`,
      );
      const prepared = await fundingPreparedSwap(recipient);
      const payload = (await prepared.json()) as {
        data: { deposit_actions: unknown };
      };
      return new Response(
        JSON.stringify({ data: { value: payload.data.deposit_actions } }),
      );
    });
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: fetchMock,
    });
    await expect(
      client.getFundingAction(REFERENCE_ID, DESTINATION, 10n * USDC),
    ).resolves.toMatchObject({
      recipient,
      amount: 10n * USDC,
      call: { entrypoint: "transfer" },
    });
  });

  it("creates only the pinned Robinhood USDG to Starknet USDC swap", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-LS-APIKEY")).toBe("partner-key");
      expect(new Headers(init?.headers).get("X-LS-CORRELATION-ID")).toBe(
        REFERENCE_ID,
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        source_network: "ROBINHOOD_MAINNET",
        source_token: "USDG",
        destination_network: "STARKNET_MAINNET",
        destination_token: "USDC",
        amount: "10",
        source_address: SOURCE,
        destination_address: DESTINATION,
        refund_address: SOURCE,
        reference_id: REFERENCE_ID,
        refuel: false,
        use_deposit_address: false,
        use_depository: false,
        use_gasless: false,
        force_user_execution: false,
      });
      return preparedSwap();
    });
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: fetchMock,
    });

    await expect(
      client.createReturnSwap({
        amountIn: 10n * USDC,
        sourceAddress: SOURCE,
        destinationAddress: DESTINATION,
        refundAddress: SOURCE,
        referenceId: REFERENCE_ID,
      }),
    ).resolves.toMatchObject({
      swap: {
        id: SWAP_ID,
        status: "user_transfer_pending",
        amountIn: 10n * USDC,
      },
      depositActions: [
        {
          type: "transfer",
          amount: 10n * USDC,
          token: "USDG",
          toAddress: DEPOSIT_TO,
          callData: "0x1234",
        },
      ],
    });
  });

  it("requires the partner key before swap creation", async () => {
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      fetch: vi.fn(),
    });
    await expect(
      client.createReturnSwap({
        amountIn: 10n * USDC,
        sourceAddress: SOURCE,
        destinationAddress: DESTINATION,
        refundAddress: SOURCE,
        referenceId: REFERENCE_ID,
      }),
    ).rejects.toThrow("API key is required");
  });

  it("rejects deposit actions that change the token or amount", async () => {
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: async () => preparedSwap({ amount_in_base_units: "9999999" }),
    });
    await expect(
      client.createReturnSwap({
        amountIn: 10n * USDC,
        sourceAddress: SOURCE,
        destinationAddress: DESTINATION,
        refundAddress: SOURCE,
        referenceId: REFERENCE_ID,
      }),
    ).rejects.toThrow("changed the deposit amount");
  });

  it("parses a status response without trusting a different route", async () => {
    const body = await preparedSwap().json();
    const client = new LayerswapClient({
      baseUrl: "https://layerswap.example/api/v2",
      apiKey: "partner-key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: null,
            data: { swap: body.data.swap, quote: body.data.quote },
          }),
        ),
    });
    await expect(client.getSwap(SWAP_ID)).resolves.toMatchObject({
      id: SWAP_ID,
      destinationAddress: DESTINATION,
      status: "user_transfer_pending",
    });
  });
});

function fundingPreparedSwap(
  recipient: string,
  calls: readonly Record<string, unknown>[] = [starknetTransferCall(recipient)],
): Response {
  return new Response(
    JSON.stringify({
      error: null,
      data: {
        quote: {
          source_network: { name: "STARKNET_MAINNET" },
          source_token: { symbol: "USDC" },
          destination_network: { name: "ROBINHOOD_MAINNET" },
          destination_token: { symbol: "USDG" },
          requested_amount: 10,
          receive_amount: 9.63,
          min_receive_amount: 9.58,
          total_fee: 0.37,
          avg_completion_time: "00:00:22.25",
          path: [{ provider: "LAYERSWAP", order: 0 }],
        },
        swap: {
          id: SWAP_ID,
          created_date: "2026-08-27T12:00:00Z",
          source_network: { name: "STARKNET_MAINNET" },
          source_token: {
            symbol: "USDC",
            contract: LAYERSWAP_STARKNET_USDC_ADDRESS,
            decimals: 6,
          },
          destination_network: { name: "ROBINHOOD_MAINNET" },
          destination_token: {
            symbol: "USDG",
            contract: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
            decimals: 6,
          },
          requested_amount: 10,
          destination_address: SOURCE,
          source_address: DESTINATION,
          status: "user_transfer_pending",
          fail_reason: null,
          use_deposit_address: false,
          metadata: { sequence_number: 1, reference_id: REFERENCE_ID },
          transactions: [],
        },
        deposit_actions: [
          {
            type: "transfer",
            order: 0,
            network: { name: "STARKNET_MAINNET" },
            token: {
              symbol: "USDC",
              contract: LAYERSWAP_STARKNET_USDC_ADDRESS,
              decimals: 6,
            },
            to_address: recipient,
            amount: 10,
            amount_in_base_units: "10000000",
            call_data: JSON.stringify(calls),
          },
        ],
      },
    }),
  );
}

function starknetTransferCall(recipient: string): Record<string, unknown> {
  return {
    contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    entrypoint: "transfer",
    calldata: [recipient, "10000000", "0"],
  };
}
