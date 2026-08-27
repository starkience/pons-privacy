import type { RelayExecutionRequest } from "@pons-privacy/sdk";
import { relayExecutionRequestJson } from "@pons-privacy/sdk";

export interface TradeAccount {
  readonly account: string;
  readonly owner: string;
  readonly accountIndex: number;
}

export interface TradePosition {
  readonly account: string;
  readonly token: string;
  readonly curve: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly tokenBalance: bigint;
  readonly usdgBalance: bigint;
}

export interface TradePreview extends TradeAccount {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly side: "buy" | "sell";
  readonly token: string;
  readonly curve: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly amountIn: bigint;
  readonly expectedAmountOut: bigint;
  readonly minimumAmountOut: bigint;
  readonly slippageBps: number;
}

export interface TradeSubmission {
  readonly requestId: string;
  readonly status: "queued" | "submitted";
  readonly account: string;
  readonly transactionHash?: string;
}

export interface TradeStatus {
  readonly status: "pending" | "success" | "reverted";
  readonly transactionHash: string;
  readonly position?: TradePosition;
}

export interface TradeApi {
  position(account: string, token: string): Promise<TradePosition>;
  preview(request: {
    side: "buy" | "sell";
    token: string;
    amount: bigint;
    slippageBps: number;
    account: TradeAccount;
  }): Promise<TradePreview>;
  submit(
    previewId: string,
    request: RelayExecutionRequest,
  ): Promise<TradeSubmission>;
  status(
    transactionHash: string,
    account: string,
    token: string,
  ): Promise<TradeStatus>;
}

export function createTradeApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): TradeApi {
  const base = baseUrl.replace(/\/$/, "");
  const post = <T>(path: string, body: Record<string, unknown>) =>
    request<T>(fetchImpl, `${base}${path}`, body);
  return {
    async position(account, token) {
      return parsePosition(
        await post<Record<string, unknown>>("/v1/trades/position", {
          account,
          token,
        }),
      );
    },
    async preview(input) {
      const payload = await post<Record<string, unknown>>(
        "/v1/trades/preview",
        {
          side: input.side,
          token: input.token,
          amount: input.amount.toString(),
          slippageBps: input.slippageBps,
          ...input.account,
        },
      );
      return {
        previewId: string(payload.previewId, "previewId"),
        expiresAt: string(payload.expiresAt, "expiresAt"),
        side: side(payload.side),
        account: string(payload.account, "account"),
        owner: string(payload.owner, "owner"),
        accountIndex: safeNumber(payload.accountIndex, "accountIndex"),
        token: string(payload.token, "token"),
        curve: string(payload.curve, "curve"),
        tokenSymbol: string(payload.tokenSymbol, "tokenSymbol"),
        tokenDecimals: safeNumber(payload.tokenDecimals, "tokenDecimals"),
        amountIn: bigint(payload.amountIn, "amountIn"),
        expectedAmountOut: bigint(
          payload.expectedAmountOut,
          "expectedAmountOut",
        ),
        minimumAmountOut: bigint(payload.minimumAmountOut, "minimumAmountOut"),
        slippageBps: safeNumber(payload.slippageBps, "slippageBps"),
      };
    },
    submit: (previewId, relayRequest) =>
      post<TradeSubmission>("/v1/trades", {
        previewId,
        idempotencyKey: previewId,
        relayRequest: relayExecutionRequestJson(relayRequest),
      }),
    async status(transactionHash, account, token) {
      const payload = await post<Record<string, unknown>>("/v1/trades/status", {
        transactionHash,
        account,
        token,
      });
      const status = string(payload.status, "status");
      if (
        status !== "pending" &&
        status !== "success" &&
        status !== "reverted"
      ) {
        throw new Error("Trade API returned an invalid status");
      }
      return {
        status,
        transactionHash: string(payload.transactionHash, "transactionHash"),
        ...(payload.position
          ? { position: parsePosition(record(payload.position, "position")) }
          : {}),
      };
    },
  };
}

async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-pons-request": "1",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const payload = (await response.json().catch(() => undefined)) as
    Record<string, unknown> | undefined;
  if (!response.ok) {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Trade service rejected the request",
    );
  }
  return payload as T;
}

function parsePosition(payload: Record<string, unknown>): TradePosition {
  return {
    account: string(payload.account, "account"),
    token: string(payload.token, "token"),
    curve: string(payload.curve, "curve"),
    tokenSymbol: string(payload.tokenSymbol, "tokenSymbol"),
    tokenDecimals: safeNumber(payload.tokenDecimals, "tokenDecimals"),
    tokenBalance: bigint(payload.tokenBalance, "tokenBalance"),
    usdgBalance: bigint(payload.usdgBalance, "usdgBalance"),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function bigint(value: unknown, field: string): bigint {
  const parsed = string(value, field);
  if (!/^(0|[1-9][0-9]*)$/.test(parsed)) {
    throw new Error(`${field} must be an unsigned integer`);
  }
  return BigInt(parsed);
}

function safeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a safe integer`);
  }
  return value;
}

function side(value: unknown): "buy" | "sell" {
  if (value !== "buy" && value !== "sell") {
    throw new Error("side must be buy or sell");
  }
  return value;
}
