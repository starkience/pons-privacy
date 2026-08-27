import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { PonsPrivacyRelayer } from "./relayer.js";
import { parseRelayRequest } from "./schema.js";

const MAX_BODY_BYTES = 128 * 1024;

export interface RelayerServerOptions {
  readonly apiKey: string;
  readonly host?: string;
}

export function startRelayerServer(
  relayer: PonsPrivacyRelayer,
  port: number,
  options: RelayerServerOptions,
) {
  if (Buffer.byteLength(options.apiKey) < 32) {
    throw new Error("RELAYER_API_KEY must contain at least 32 bytes");
  }
  const host = options.host ?? "127.0.0.1";
  return createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/healthz") {
        return json(response, 200, {
          ok: true,
          chainId: 4663,
          policy: "pons-v2",
        });
      }
      if (request.method !== "POST" || request.url !== "/v1/relay") {
        return json(response, 404, { error: "not found" });
      }
      if (!authorized(request, options.apiKey)) {
        return json(response, 401, { error: "unauthorized" });
      }
      const requestId = randomUUID();
      try {
        const relayRequest = parseRelayRequest(await readJson(request));
        const transactionHash = await relayer.relay(relayRequest);
        console.info(
          JSON.stringify({
            event: "relay.broadcast",
            requestId,
            transactionHash,
          }),
        );
        return json(response, 202, { transactionHash, requestId });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "unknown error";
        console.error(
          JSON.stringify({
            event: "relay.rejected",
            requestId,
            broadcasted: false,
            error: message,
          }),
        );
        return json(response, 400, {
          error: message,
          requestId,
          broadcasted: false,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return json(response, 400, { error: message });
    }
  }).listen(port, host);
}

function authorized(request: IncomingMessage, expectedApiKey: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(expectedApiKey);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Error("invalid JSON");
  }
}

function json(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
