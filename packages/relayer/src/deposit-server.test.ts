import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LayerswapDepositAction,
  LayerswapQuote,
  LayerswapSwap,
} from "@pons-privacy/sdk";
import {
  startDepositServer,
  type LayerswapDepositGateway,
} from "./deposit-server.js";

const SOURCE = "0x1111111111111111111111111111111111111111";
const DESTINATION =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const SWAP_ID = "16692477-6f05-4d6e-aa30-4b2dd753c63d";
const servers: ReturnType<typeof startDepositServer>[] = [];

const quote: LayerswapQuote = {
  provider: "layerswap",
  direction: "return-to-strk20",
  sourceNetwork: "ROBINHOOD_MAINNET",
  sourceAsset: "USDG",
  destinationNetwork: "STARKNET_MAINNET",
  destinationAsset: "USDC",
  amountIn: 10_000_000n,
  expectedAmountOut: 9_600_000n,
  minAmountOut: 9_500_000n,
  feeAmount: 400_000n,
  expiresAt: 1_000,
  averageCompletionSeconds: 22,
  path: ["LAYERSWAP"],
};

const swap: LayerswapSwap = {
  id: SWAP_ID,
  createdAt: "2026-08-27T12:00:00Z",
  status: "user_transfer_pending",
  sourceAddress: SOURCE,
  destinationAddress: DESTINATION,
  amountIn: 10_000_000n,
  useDepositAddress: false,
  transactions: [],
};

const actions: LayerswapDepositAction[] = [
  {
    type: "transfer",
    order: 0,
    network: "ROBINHOOD_MAINNET",
    token: "USDG",
    tokenAddress: "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
    toAddress: "0x2222222222222222222222222222222222222222",
    amount: 10_000_000n,
    callData: "0x1234",
  },
];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function harness(swapCreationEnabled = false) {
  const gateway: LayerswapDepositGateway = {
    quote: vi.fn(async () => quote),
    limits: vi.fn(async () => ({
      direction: "return-to-strk20",
      minAmount: 480_313n,
      maxAmount: 242_000_000n,
    })),
    createReturnSwap: vi.fn(async () => ({
      quote,
      swap,
      depositActions: actions,
    })),
    getSwap: vi.fn(async () => swap),
    getDepositActions: vi.fn(async () => actions),
  };
  const server = startDepositServer(gateway, 0, {
    swapCreationEnabled,
    destinationAddress: DESTINATION,
  });
  servers.push(server);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { gateway, url: `http://127.0.0.1:${port}` };
}

describe("LayerSwap deposit API", () => {
  it("serves quotes with bigint amounts serialized exactly", async () => {
    const { gateway, url } = await harness();
    const response = await fetch(`${url}/v1/deposits/quote?amount=10000000`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      amountIn: "10000000",
      expectedAmountOut: "9600000",
    });
    expect(gateway.quote).toHaveBeenCalledWith("return-to-strk20", 10_000_000n);
  });

  it("keeps mainnet swap creation behind the explicit server gate", async () => {
    const { gateway, url } = await harness(false);
    const response = await fetch(`${url}/v1/deposits/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: "10000000", sourceAddress: SOURCE }),
    });
    expect(response.status).toBe(503);
    expect(gateway.createReturnSwap).not.toHaveBeenCalled();
  });

  it("controls destination and refund addresses on creation", async () => {
    const { gateway, url } = await harness(true);
    const response = await fetch(`${url}/v1/deposits/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amount: "10000000",
        sourceAddress: SOURCE,
        destinationAddress: "0x123",
      }),
    });
    expect(response.status).toBe(201);
    expect(gateway.createReturnSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        amountIn: 10_000_000n,
        sourceAddress: SOURCE,
        refundAddress: SOURCE,
        destinationAddress: DESTINATION,
        useGasless: false,
      }),
    );
  });

  it("does not expose status or actions to a different source address", async () => {
    const { gateway, url } = await harness();
    const other = "0x3333333333333333333333333333333333333333";
    const response = await fetch(
      `${url}/v1/deposits/swaps/${SWAP_ID}/deposit-actions?sourceAddress=${other}`,
    );
    expect(response.status).toBe(404);
    expect(gateway.getDepositActions).not.toHaveBeenCalled();
  });
});
