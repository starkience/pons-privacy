import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type {
  CreateLayerswapReturnSwap,
  LayerswapClient,
  LayerswapDepositAction,
  LayerswapPreparedSwap,
  LayerswapQuote,
  LayerswapSwap,
} from "@pons-privacy/sdk";
import { isAddress, type Address } from "viem";

const MAX_BODY_BYTES = 16 * 1024;
const BASE_UNIT_PATTERN = /^[1-9][0-9]*$/;

export type LayerswapDepositGateway = Pick<
  LayerswapClient,
  "quote" | "limits" | "createReturnSwap" | "getSwap" | "getDepositActions"
>;

export interface DepositServerOptions {
  readonly host?: string;
  readonly swapCreationEnabled: boolean;
  readonly destinationAddress?: string;
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
          destinationConfigured: Boolean(options.destinationAddress),
          actionSigningEnabled: false,
        });
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
      if (request.method === "POST" && url.pathname === "/v1/deposits/swaps") {
        if (!options.swapCreationEnabled) {
          throw new HttpError(503, "mainnet LayerSwap creation is disabled");
        }
        if (!options.destinationAddress) {
          throw new HttpError(
            503,
            "STRK20 destination account is not configured",
          );
        }
        const body = record(await readJson(request), "request");
        const amountIn = baseUnits(body.amount, "amount");
        const sourceAddress = evmAddress(body.sourceAddress, "sourceAddress");
        const createRequest: CreateLayerswapReturnSwap = {
          amountIn,
          sourceAddress,
          destinationAddress: options.destinationAddress,
          refundAddress: sourceAddress,
          referenceId: randomUUID(),
          useGasless: false,
        };
        const prepared = await layerswap.createReturnSwap(createRequest);
        return json(response, 201, prepared);
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

function evmAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value) || BigInt(value) === 0n) {
    throw new HttpError(400, `${field} must be a non-zero EVM address`);
  }
  return value as Address;
}

function baseUnits(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !BASE_UNIT_PATTERN.test(value)) {
    throw new HttpError(400, `${field} must be a positive base-unit integer`);
  }
  return BigInt(value);
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

function json(
  response: ServerResponse,
  status: number,
  body:
    | Record<string, unknown>
    | LayerswapQuote
    | LayerswapPreparedSwap
    | LayerswapSwap
    | readonly LayerswapDepositAction[]
    | object,
): void {
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
