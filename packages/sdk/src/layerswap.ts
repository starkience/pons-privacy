import { formatUnits, parseUnits } from "viem";
import type {
  StableTransportQuote,
  TransportAsset,
  TransportDirection,
  TransportNetwork,
} from "./transport.js";

export const LAYERSWAP_API_URL = "https://api.layerswap.io/api/v2";
export const LAYERSWAP_QUOTE_TTL_MS = 30_000;

interface LayerswapRoute {
  readonly sourceNetwork: TransportNetwork;
  readonly sourceAsset: TransportAsset;
  readonly destinationNetwork: TransportNetwork;
  readonly destinationAsset: TransportAsset;
}

const ROUTES: Record<TransportDirection, LayerswapRoute> = {
  "fund-robinhood": {
    sourceNetwork: "STARKNET_MAINNET",
    sourceAsset: "USDC",
    destinationNetwork: "ROBINHOOD_MAINNET",
    destinationAsset: "USDG",
  },
  "return-to-strk20": {
    sourceNetwork: "ROBINHOOD_MAINNET",
    sourceAsset: "USDG",
    destinationNetwork: "STARKNET_MAINNET",
    destinationAsset: "USDC",
  },
};

export interface LayerswapQuote extends StableTransportQuote {
  readonly provider: "layerswap";
  readonly averageCompletionSeconds: number;
  readonly path: readonly string[];
}

export interface LayerswapQuoteClientOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly quoteTtlMs?: number;
}

export class LayerswapQuoteClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly quoteTtlMs: number;
  private readonly apiKey: string | undefined;

  constructor(options: LayerswapQuoteClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? LAYERSWAP_API_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.quoteTtlMs = options.quoteTtlMs ?? LAYERSWAP_QUOTE_TTL_MS;
    this.apiKey = options.apiKey;
    if (!Number.isSafeInteger(this.quoteTtlMs) || this.quoteTtlMs <= 0) {
      throw new Error("LayerSwap quote TTL must be a positive integer");
    }
  }

  async quote(
    direction: TransportDirection,
    amountIn: bigint,
  ): Promise<LayerswapQuote> {
    if (amountIn <= 0n) {
      throw new Error("LayerSwap quote amount must be positive");
    }
    const route = ROUTES[direction];
    const query = new URLSearchParams({
      source_network: route.sourceNetwork,
      source_token: route.sourceAsset,
      destination_network: route.destinationNetwork,
      destination_token: route.destinationAsset,
      amount: formatUnits(amountIn, 6),
    });
    const headers = new Headers({ accept: "application/json" });
    if (this.apiKey) headers.set("X-LS-APIKEY", this.apiKey);
    const response = await this.fetchImpl(`${this.baseUrl}/quote?${query}`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const payload = await readPayload(response);
    if (!response.ok || payload.error !== null) {
      throw new Error(
        errorMessage(payload.error) ??
          `LayerSwap quote failed with HTTP ${response.status}`,
      );
    }
    const quote = record(record(payload.data, "data").quote, "data.quote");
    assertNamed(
      record(quote.source_network, "source_network"),
      route.sourceNetwork,
    );
    assertNamed(record(quote.source_token, "source_token"), route.sourceAsset);
    assertNamed(
      record(quote.destination_network, "destination_network"),
      route.destinationNetwork,
    );
    assertNamed(
      record(quote.destination_token, "destination_token"),
      route.destinationAsset,
    );

    const requestedAmount = units(quote.requested_amount, "requested_amount");
    if (requestedAmount !== amountIn) {
      throw new Error("LayerSwap quote changed the requested amount");
    }
    const expectedAmountOut = units(quote.receive_amount, "receive_amount");
    const minAmountOut = units(quote.min_receive_amount, "min_receive_amount");
    const feeAmount = units(quote.total_fee, "total_fee");
    if (minAmountOut <= 0n || expectedAmountOut < minAmountOut) {
      throw new Error("LayerSwap quote returned invalid output bounds");
    }
    const quotedAt = this.now();
    return {
      provider: "layerswap",
      direction,
      ...route,
      amountIn,
      expectedAmountOut,
      minAmountOut,
      feeAmount,
      expiresAt: quotedAt + this.quoteTtlMs,
      averageCompletionSeconds: durationSeconds(
        quote.avg_completion_time,
        "avg_completion_time",
      ),
      path: path(recordArray(quote.path, "path")),
    };
  }
}

function normalizeBaseUrl(value: string): string {
  const base = value.replace(/\/$/, "");
  if (!base) throw new Error("LayerSwap API URL is required");
  if (base.startsWith("/") || base.startsWith("https://")) return base;
  throw new Error("LayerSwap API URL must be relative or use HTTPS");
}

async function readPayload(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return record(await response.json(), "LayerSwap response");
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("must be an object")) {
      throw cause;
    }
    throw new Error("LayerSwap returned invalid JSON");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => record(entry, `${field}[${index}]`));
}

function assertNamed(value: Record<string, unknown>, expected: string): void {
  if (value.name !== expected && value.symbol !== expected) {
    throw new Error(`LayerSwap quote route mismatch: expected ${expected}`);
  }
}

function units(value: unknown, field: string): bigint {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`${field} must be numeric`);
  }
  const decimal = String(value);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(decimal)) {
    throw new Error(
      `${field} must be a non-negative decimal with at most six places`,
    );
  }
  try {
    return parseUnits(decimal, 6);
  } catch {
    throw new Error(`${field} exceeds six decimal places`);
  }
}

function durationSeconds(value: unknown, field: string): number {
  if (typeof value !== "string") throw new Error(`${field} must be a duration`);
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`${field} must use HH:MM:SS format`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) {
    throw new Error(`${field} contains an invalid time`);
  }
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  return hours * 3_600 + minutes * 60 + seconds + fraction;
}

function path(entries: Record<string, unknown>[]): string[] {
  return entries.map((entry, index) => {
    if (typeof entry.provider !== "string" || !entry.provider) {
      throw new Error(`path[${index}].provider must be a string`);
    }
    return entry.provider;
  });
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message ? message : undefined;
}
