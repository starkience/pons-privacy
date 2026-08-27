import type { LayerswapQuote } from "@pons-privacy/sdk";

export interface DepositQuoteApi {
  quote(amountIn: bigint): Promise<LayerswapQuote>;
}

export function createDepositQuoteApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): DepositQuoteApi {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return {
    async quote(amountIn) {
      if (amountIn <= 0n) throw new Error("Deposit amount must be positive");
      const query = new URLSearchParams({ amount: amountIn.toString() });
      const response = await fetchImpl(
        `${normalizedBaseUrl}/deposits/quote?${query}`,
        {
          method: "GET",
          headers: { accept: "application/json" },
          cache: "no-store",
        },
      );
      const payload = await json(response);
      if (!response.ok) {
        throw new Error(
          errorMessage(payload) ?? "Could not quote this deposit",
        );
      }
      return parseQuote(payload, amountIn);
    },
  };
}

function parseQuote(
  payload: Record<string, unknown>,
  requestedAmount: bigint,
): LayerswapQuote {
  if (
    payload.provider !== "layerswap" ||
    payload.direction !== "return-to-strk20" ||
    payload.sourceNetwork !== "ROBINHOOD_MAINNET" ||
    payload.sourceAsset !== "USDG" ||
    payload.destinationNetwork !== "STARKNET_MAINNET" ||
    payload.destinationAsset !== "USDC"
  ) {
    throw new Error("Deposit API returned an unexpected route");
  }
  const amountIn = bigint(payload.amountIn, "amountIn");
  if (amountIn !== requestedAmount) {
    throw new Error("Deposit API changed the requested amount");
  }
  const expectedAmountOut = bigint(
    payload.expectedAmountOut,
    "expectedAmountOut",
  );
  const minAmountOut = bigint(payload.minAmountOut, "minAmountOut");
  const feeAmount = bigint(payload.feeAmount, "feeAmount");
  const expiresAt = safeNumber(payload.expiresAt, "expiresAt");
  const averageCompletionSeconds = finiteNumber(
    payload.averageCompletionSeconds,
    "averageCompletionSeconds",
  );
  if (!Array.isArray(payload.path) || !payload.path.every(isNonEmptyString)) {
    throw new Error("path must be a string array");
  }
  if (minAmountOut <= 0n || expectedAmountOut < minAmountOut) {
    throw new Error("Deposit API returned invalid output bounds");
  }
  return {
    provider: "layerswap",
    direction: "return-to-strk20",
    sourceNetwork: "ROBINHOOD_MAINNET",
    sourceAsset: "USDG",
    destinationNetwork: "STARKNET_MAINNET",
    destinationAsset: "USDC",
    amountIn,
    expectedAmountOut,
    minAmountOut,
    feeAmount,
    expiresAt,
    averageCompletionSeconds,
    path: payload.path,
  };
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (
    !normalized ||
    (!normalized.startsWith("/") && !normalized.startsWith("https://"))
  ) {
    throw new Error("Deposit API URL must be relative or use HTTPS");
  }
  return normalized;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Deposit API returned invalid JSON");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid JSON")) {
      throw error;
    }
    throw new Error("Deposit API returned invalid JSON");
  }
}

function bigint(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a base-unit integer`);
  }
  return BigInt(value);
}

function safeNumber(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return Number(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function errorMessage(payload: Record<string, unknown>): string | undefined {
  return typeof payload.error === "string" && payload.error
    ? payload.error
    : undefined;
}

export function parseUsdAmount(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{0,6})?$/.test(normalized)) {
    throw new Error("Enter a USDG amount with up to 6 decimals");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("Deposit amount must be positive");
  return amount;
}

export function formatUsdAmount(amount: bigint, maximumDecimals = 2): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .slice(0, maximumDecimals)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
