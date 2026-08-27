import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  CreateLayerswapReturnSwap,
  LayerswapClient,
  LayerswapDepositAction,
  LayerswapFundingSwap,
  LayerswapPreparedFundingSwap,
  LayerswapPreparedSwap,
  LayerswapQuote,
  LayerswapSwap,
} from "@pons-privacy/sdk";
import { isAddress, type Address } from "viem";
import {
  forwardAvnuPaymasterRequest,
  type AvnuPaymasterProxyOptions,
} from "./paymaster-proxy.js";

const MAX_BODY_BYTES = 64 * 1024;
const BASE_UNIT_PATTERN = /^[1-9][0-9]*$/;

export type LayerswapDepositGateway = Pick<
  LayerswapClient,
  | "quote"
  | "limits"
  | "createReturnSwap"
  | "createFundingSwap"
  | "getSwap"
  | "getFundingSwap"
  | "getFundingAction"
  | "getDepositActions"
>;

export interface DepositServerOptions {
  readonly host?: string;
  readonly swapCreationEnabled: boolean;
  readonly fundingSwapCreationEnabled: boolean;
  readonly paymaster?: AvnuPaymasterProxyOptions;
}

export function startDepositServer(
  layerswap: LayerswapDepositGateway,
  port: number,
  options: DepositServerOptions,
) {
  const host = options.host ?? "127.0.0.1";
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json(response, 200, {
          ok: true,
          provider: "layerswap",
          network: "mainnet",
          swapCreationEnabled: options.swapCreationEnabled,
          fundingSwapCreationEnabled: options.fundingSwapCreationEnabled,
          perUserStarknetAccounts: true,
          paymasterProxyEnabled: Boolean(options.paymaster),
          actionSigningEnabled: false,
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/paymaster") {
        if (!options.paymaster) {
          throw new HttpError(503, "AVNU paymaster proxy is not configured");
        }
        const proxied = await forwardAvnuPaymasterRequest(
          await readJson(request),
          options.paymaster,
        );
        return json(response, proxied.status, proxied.body);
      }
      if (request.method === "GET" && url.pathname === "/v1/deposits/limits") {
        return json(response, 200, await layerswap.limits("return-to-strk20"));
      }
      if (request.method === "GET" && url.pathname === "/v1/deposits/quote") {
        const amount = amountFromQuery(url);
        return json(
          response,
          200,
          await layerswap.quote("return-to-strk20", amount),
        );
      }
      if (request.method === "GET" && url.pathname === "/v1/funding/limits") {
        return json(response, 200, await layerswap.limits("fund-robinhood"));
      }
      if (request.method === "GET" && url.pathname === "/v1/funding/quote") {
        const amount = amountFromQuery(url);
        return json(
          response,
          200,
          await layerswap.quote("fund-robinhood", amount),
        );
      }
      if (request.method === "POST" && url.pathname === "/v1/deposits/swaps") {
        if (!options.swapCreationEnabled) {
          throw new HttpError(503, "mainnet LayerSwap creation is disabled");
        }
        const body = record(await readJson(request), "request");
        const amountIn = baseUnits(body.amount, "amount");
        const sourceAddress = evmAddress(body.sourceAddress, "sourceAddress");
        const destinationAddress = starknetAddress(
          body.destinationAddress,
          "destinationAddress",
        );
        const operationId = operationReference(body.operationId);
        const createRequest: CreateLayerswapReturnSwap = {
          amountIn,
          sourceAddress,
          destinationAddress,
          refundAddress: sourceAddress,
          referenceId: operationId,
          useGasless: false,
        };
        const prepared = await layerswap.createReturnSwap(createRequest);
        return json(response, 201, prepared);
      }

      if (request.method === "POST" && url.pathname === "/v1/funding/swaps") {
        if (!options.fundingSwapCreationEnabled) {
          throw new HttpError(503, "mainnet LayerSwap funding is disabled");
        }
        const body = record(await readJson(request), "request");
        const amountIn = baseUnits(body.amount, "amount");
        const sourceAddress = starknetAddress(
          body.sourceAddress,
          "sourceAddress",
        );
        const destinationAddress = evmAddress(
          body.destinationAddress,
          "destinationAddress",
        );
        const operationId = operationReference(body.operationId);
        const prepared = await layerswap.createFundingSwap({
          amountIn,
          sourceAddress,
          destinationAddress,
          referenceId: operationId,
        });
        return json(response, 201, prepared);
      }

      const fundingMatch =
        /^\/v1\/funding\/swaps\/([^/]+)(\/deposit-action)?$/.exec(url.pathname);
      if (request.method === "GET" && fundingMatch) {
        const swapId = decodeURIComponent(fundingMatch[1]!);
        const sourceAddress = starknetAddress(
          url.searchParams.get("sourceAddress"),
          "sourceAddress",
        );
        const swap = await layerswap.getFundingSwap(swapId);
        assertFundingSwapOwner(swap, sourceAddress);
        if (!fundingMatch[2]) return json(response, 200, swap);
        if (swap.status !== "user_transfer_pending") {
          throw new HttpError(
            409,
            "funding swap no longer accepts a source transfer",
          );
        }
        const action = await layerswap.getFundingAction(
          swapId,
          sourceAddress,
          swap.amountIn,
        );
        return json(response, 200, { swap, action });
      }

      const match = /^\/v1\/deposits\/swaps\/([^/]+)(\/deposit-actions)?$/.exec(
        url.pathname,
      );
      if (request.method === "GET" && match) {
        const swapId = decodeURIComponent(match[1]!);
        const sourceAddress = evmAddress(
          url.searchParams.get("sourceAddress"),
          "sourceAddress",
        );
        const swap = await layerswap.getSwap(swapId);
        assertSwapOwner(swap, sourceAddress);
        if (!match[2]) return json(response, 200, swap);
        if (swap.status !== "user_transfer_pending") {
          throw new HttpError(
            409,
            "deposit swap no longer accepts a source transfer",
          );
        }
        const actions = await layerswap.getDepositActions(
          swapId,
          sourceAddress,
          swap.amountIn,
        );
        return json(response, 200, { swap, actions });
      }
      return json(response, 404, { error: "not found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      const message = error instanceof Error ? error.message : "unknown error";
      return json(response, status, { error: message });
    }
  }).listen(port, host);
}

function amountFromQuery(url: URL): bigint {
  return baseUnits(url.searchParams.get("amount"), "amount");
}

function assertSwapOwner(swap: LayerswapSwap, sourceAddress: Address): void {
  if (
    !swap.sourceAddress ||
    swap.sourceAddress.toLowerCase() !== sourceAddress.toLowerCase()
  ) {
    throw new HttpError(404, "swap not found");
  }
}

function assertFundingSwapOwner(
  swap: LayerswapFundingSwap,
  sourceAddress: string,
): void {
  if (BigInt(swap.sourceAddress) !== BigInt(sourceAddress)) {
    throw new HttpError(404, "swap not found");
  }
}

function evmAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value) || BigInt(value) === 0n) {
    throw new HttpError(400, `${field} must be a non-zero EVM address`);
  }
  return value as Address;
}

function starknetAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new HttpError(400, `${field} must be a non-zero Starknet address`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= 2n ** 251n) {
    throw new HttpError(400, `${field} must be a non-zero Starknet address`);
  }
  return `0x${parsed.toString(16)}`;
}

function baseUnits(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !BASE_UNIT_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must be a positive base-unit integer`);
  }
  return BigInt(value);
}

function operationReference(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new HttpError(400, "operationId must be a UUIDv4");
  }
  return value.toLowerCase();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "request body too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(
    JSON.stringify(body, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
