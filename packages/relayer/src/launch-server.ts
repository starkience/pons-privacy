import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { PonsLaunchApplication } from "./launch-application.js";
import { LaunchApplicationError } from "./launch-application.js";
import { parseRelayRequest } from "./schema.js";
import {
  PonsTradeApplication,
  TradeApplicationError,
} from "./trade-application.js";

const MAX_BODY_BYTES = 128 * 1024;

export interface LaunchServerOptions {
  readonly host?: string;
  readonly allowedOrigin?: string;
  readonly submissionEnabled: boolean;
  readonly tradeApplication?: PonsTradeApplication;
  readonly tradeSubmissionEnabled?: boolean;
}

export function startLaunchServer(
  application: PonsLaunchApplication,
  port: number,
  options: LaunchServerOptions,
) {
  const host = options.host ?? "127.0.0.1";
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        return json(response, 200, {
          ok: true,
          chainId: 4663,
          policy: "user-signed-r2-launch",
          submissionEnabled: options.submissionEnabled,
          tradeSubmissionEnabled: options.tradeSubmissionEnabled ?? false,
        });
      }
      if (request.method !== "POST") {
        return json(response, 404, { error: "not found" });
      }
      assertBrowserBoundary(request, options.allowedOrigin);
      const body = record(await readJson(request), "request");
      if (request.url === "/v1/launches/preview") {
        const preview = await application.preview(
          body.draft,
          body.launchAccount,
        );
        return json(response, 201, preview);
      }
      if (request.url === "/v1/launches") {
        const result = await application.submit({
          draft: body.draft,
          previewId: body.previewId,
          idempotencyKey: body.idempotencyKey,
          relayRequest: parseRelayRequest(body.relayRequest),
        });
        return json(response, 202, result);
      }
      if (request.url === "/v1/trades/position") {
        const result = await requireTradeApplication(options).position(body);
        return json(response, 200, result);
      }
      if (request.url === "/v1/trades/preview") {
        const result = await requireTradeApplication(options).preview(body);
        return json(response, 201, result);
      }
      if (request.url === "/v1/trades") {
        const result = await requireTradeApplication(options).submit({
          previewId: body.previewId,
          idempotencyKey: body.idempotencyKey,
          relayRequest: parseRelayRequest(body.relayRequest),
        });
        return json(response, 202, result);
      }
      if (request.url === "/v1/trades/status") {
        const result = await requireTradeApplication(options).status(body);
        return json(response, 200, result);
      }
      return json(response, 404, { error: "not found" });
    } catch (error) {
      const status =
        error instanceof LaunchApplicationError ||
        error instanceof TradeApplicationError
          ? error.status
          : 400;
      const message = error instanceof Error ? error.message : "unknown error";
      return json(response, status, { error: message });
    }
  }).listen(port, host);
}

function requireTradeApplication(
  options: LaunchServerOptions,
): PonsTradeApplication {
  if (!options.tradeApplication) {
    throw new TradeApplicationError(503, "trade application is not configured");
  }
  return options.tradeApplication;
}

function assertBrowserBoundary(
  request: IncomingMessage,
  allowedOrigin: string | undefined,
): void {
  if (request.headers["x-pons-request"] !== "1") {
    throw new LaunchApplicationError(403, "missing application request header");
  }
  if (allowedOrigin && request.headers.origin !== allowedOrigin) {
    throw new LaunchApplicationError(403, "request origin is not allowed");
  }
  const contentType = request.headers["content-type"];
  if (
    typeof contentType !== "string" ||
    !contentType.startsWith("application/json")
  ) {
    throw new LaunchApplicationError(415, "application/json is required");
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new LaunchApplicationError(413, "request body too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new LaunchApplicationError(400, "invalid JSON");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchApplicationError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  response.end(
    JSON.stringify(body, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}
