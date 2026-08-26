import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { PonsPrivacyRelayer } from "./relayer.js";
import { parseRelayRequest } from "./schema.js";

const MAX_BODY_BYTES = 128 * 1024;

export function startRelayerServer(relayer: PonsPrivacyRelayer, port: number) {
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
  }).listen(port);
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
