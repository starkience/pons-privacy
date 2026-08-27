import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  LayerswapDepositAction,
  LayerswapFundingSwap,
  LayerswapQuote,
  LayerswapSwap,
  RelayExecution,
  RelayExecutionRequest,
} from "@pons-privacy/sdk";
import {
  NO_RELAYER_FEE,
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  layerswapReturnActionsToCalls,
  relayExecutionRequestJson,
} from "@pons-privacy/sdk";
import {
  startDepositServer,
  type LayerswapDepositGateway,
} from "./deposit-server.js";

const SOURCE = "0x1111111111111111111111111111111111111111";
const DESTINATION =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const SWAP_ID = "16692477-6f05-4d6e-aa30-4b2dd753c63d";
const TRANSPORT = "0x456";
const ROBINHOOD_DESTINATION = "0x2222222222222222222222222222222222222222";
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
  },
];

const fundingSwap: LayerswapFundingSwap = {
  id: SWAP_ID,
  createdAt: "2026-08-27T12:00:00Z",
  status: "user_transfer_pending",
  sourceAddress: TRANSPORT,
  destinationAddress: ROBINHOOD_DESTINATION,
  amountIn: 10_000_000n,
  useDepositAddress: false,
  transactions: [],
};

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

async function harness(
  swapCreationEnabled = false,
  fundingSwapCreationEnabled = false,
  evmRelay?: RelayExecution,
) {
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
    createFundingSwap: vi.fn(async () => ({
      quote: {
        ...quote,
        direction: "fund-robinhood" as const,
        sourceNetwork: "STARKNET_MAINNET" as const,
        sourceAsset: "USDC" as const,
        destinationNetwork: "ROBINHOOD_MAINNET" as const,
        destinationAsset: "USDG" as const,
      },
      swap: fundingSwap,
      depositAction: {
        type: "transfer" as const,
        order: 0,
        network: "STARKNET_MAINNET" as const,
        token: "USDC" as const,
        tokenAddress: "0xabc",
        amount: 10_000_000n,
        recipient: "0x987",
        call: {
          contractAddress: "0xabc",
          entrypoint: "transfer" as const,
          calldata: ["0x987", "10000000", "0"] as const,
        },
      },
    })),
    recoverReturnSwap: vi.fn(async () => ({
      quote,
      swap,
      depositActions: actions,
    })),
    recoverFundingSwap: vi.fn(async () => ({
      quote: {
        ...quote,
        direction: "fund-robinhood" as const,
        sourceNetwork: "STARKNET_MAINNET" as const,
        sourceAsset: "USDC" as const,
        destinationNetwork: "ROBINHOOD_MAINNET" as const,
        destinationAsset: "USDG" as const,
      },
      swap: fundingSwap,
      depositAction: {
        type: "transfer" as const,
        order: 0,
        network: "STARKNET_MAINNET" as const,
        token: "USDC" as const,
        tokenAddress: "0xabc",
        amount: 10_000_000n,
        recipient: "0x987",
        call: {
          contractAddress: "0xabc",
          entrypoint: "transfer" as const,
          calldata: ["0x987", "10000000", "0"] as const,
        },
      },
    })),
    getSwap: vi.fn(async () => swap),
    getFundingSwap: vi.fn(async () => fundingSwap),
    getFundingAction: vi.fn(async () => ({
      type: "transfer" as const,
      order: 0,
      network: "STARKNET_MAINNET" as const,
      token: "USDC" as const,
      tokenAddress: "0xabc",
      amount: 10_000_000n,
      recipient: "0x987",
      call: {
        contractAddress: "0xabc",
        entrypoint: "transfer" as const,
        calldata: ["0x987", "10000000", "0"] as const,
      },
    })),
    getDepositActions: vi.fn(async () => actions),
  };
  const server = startDepositServer(gateway, 0, {
    swapCreationEnabled,
    fundingSwapCreationEnabled,
    ...(evmRelay ? { evmRelay } : {}),
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

  it("serves the outbound S2 to R2 quote before any private withdrawal", async () => {
    const { gateway, url } = await harness();
    const response = await fetch(`${url}/v1/funding/quote?amount=10000000`);
    expect(response.status).toBe(200);
    expect(gateway.quote).toHaveBeenCalledWith("fund-robinhood", 10_000_000n);
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

  it("accepts the user's derived Starknet destination and controls refunds", async () => {
    const { gateway, url } = await harness(true);
    const response = await fetch(`${url}/v1/deposits/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: SWAP_ID,
        amount: "10000000",
        sourceAddress: SOURCE,
        destinationAddress: `0x${BigInt(DESTINATION).toString(16)}`,
      }),
    });
    expect(response.status).toBe(201);
    expect(gateway.createReturnSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        amountIn: 10_000_000n,
        sourceAddress: SOURCE,
        refundAddress: SOURCE,
        destinationAddress: `0x${BigInt(DESTINATION).toString(16)}`,
        useGasless: false,
        referenceId: SWAP_ID,
      }),
    );
  });

  it("creates outbound funding only from fresh S2 to fresh Robinhood R2", async () => {
    const { gateway, url } = await harness(false, true);
    const response = await fetch(`${url}/v1/funding/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: SWAP_ID,
        amount: "10000000",
        sourceAddress: TRANSPORT,
        destinationAddress: ROBINHOOD_DESTINATION,
      }),
    });
    expect(response.status).toBe(201);
    expect(gateway.createFundingSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        amountIn: 10_000_000n,
        sourceAddress: TRANSPORT,
        destinationAddress: ROBINHOOD_DESTINATION,
        referenceId: SWAP_ID,
      }),
    );
  });

  it("recovers a previously reserved operation instead of creating a duplicate", async () => {
    const { gateway, url } = await harness(false, true);
    const body = JSON.stringify({
      operationId: SWAP_ID,
      amount: "10000000",
      sourceAddress: TRANSPORT,
      destinationAddress: ROBINHOOD_DESTINATION,
    });
    const first = await fetch(`${url}/v1/funding/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const second = await fetch(`${url}/v1/funding/swaps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(gateway.createFundingSwap).toHaveBeenCalledOnce();
    expect(gateway.recoverFundingSwap).toHaveBeenCalledOnce();
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

  it("recovers the validated S2 funding action for an owned pending swap", async () => {
    const { gateway, url } = await harness();
    const response = await fetch(
      `${url}/v1/funding/swaps/${SWAP_ID}/deposit-action?sourceAddress=${TRANSPORT}`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: { token: "USDC", recipient: "0x987", amount: "10000000" },
    });
    expect(gateway.getFundingAction).toHaveBeenCalledWith(
      SWAP_ID,
      TRANSPORT,
      10_000_000n,
    );
  });

  it("relays one exact user-signed R2 return idempotently", async () => {
    const relay = vi.fn(async () => `0x${"55".repeat(32)}` as const);
    const { url } = await harness(false, false, relay);
    const relayRequest: RelayExecutionRequest = {
      chainId: 4663,
      factory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
      account: SOURCE,
      owner: "0x3333333333333333333333333333333333333333",
      accountIndex: 9,
      calls: layerswapReturnActionsToCalls(actions),
      nonce: 0n,
      deadline: 1_900_000_000n,
      prefund: 0n,
      fee: NO_RELAYER_FEE,
      signature: "0x",
      policyContext: { kind: "layerswap-return", swapId: SWAP_ID },
    };
    const body = JSON.stringify({
      sourceAddress: SOURCE,
      relayRequest: relayExecutionRequestJson(relayRequest),
    });
    const send = () =>
      fetch(`${url}/v1/deposits/swaps/${SWAP_ID}/relay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    const first = await send();
    const retry = await send();
    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    await expect(first.json()).resolves.toEqual({
      transactionHash: `0x${"55".repeat(32)}`,
    });
    expect(relay).toHaveBeenCalledOnce();
  });
});
