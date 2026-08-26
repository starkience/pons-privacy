import type { Hash } from "viem";
import type { RelayExecution, RelayExecutionRequest } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpRelayOptions {
  endpoint: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class RelayerRejectedError extends Error {
  readonly broadcasted = false;

  constructor(
    readonly status: number,
    message?: string,
    readonly requestId?: string,
  ) {
    super(
      `relayer rejected execution with status ${status}${message ? `: ${message}` : ""}`,
    );
    this.name = "RelayerRejectedError";
  }
}

export function createHttpRelay(options: HttpRelayOptions): RelayExecution {
  const endpoint = validateRelayEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("relayer timeout must be a positive safe integer");
  }

  return async (request) => {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(relayExecutionRequestJson(request)),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        `relayer returned non-JSON response with status ${response.status}`,
      );
    }
    if (!response.ok) {
      throw new RelayerRejectedError(
        response.status,
        relayErrorMessage(body),
        relayRequestId(body),
      );
    }
    if (!body || typeof body !== "object") {
      throw new Error("relayer response must be an object");
    }
    const transactionHash = (body as Record<string, unknown>).transactionHash;
    if (
      typeof transactionHash !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
    ) {
      throw new Error("relayer returned an invalid transaction hash");
    }
    return transactionHash as Hash;
  };
}

export function relayExecutionRequestJson(
  request: RelayExecutionRequest,
): Record<string, unknown> {
  return {
    ...request,
    calls: request.calls.map((call) => ({
      ...call,
      value: call.value.toString(),
    })),
    nonce: request.nonce.toString(),
    deadline: request.deadline.toString(),
    prefund: request.prefund.toString(),
    fee: { ...request.fee, amount: request.fee.amount.toString() },
  };
}

function validateRelayEndpoint(value: string): string {
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("relayer endpoint must be a same-origin path or URL");
  }
  const localDevelopment =
    parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localDevelopment) {
    throw new Error(
      "relayer endpoint must use HTTPS outside local development",
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error("relayer endpoint must not contain credentials");
  }
  return parsed.href;
}

function relayRequestId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.trim()
    ? requestId.slice(0, 80)
    : undefined;
}

function relayErrorMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error.trim()
    ? error.slice(0, 300)
    : undefined;
}
