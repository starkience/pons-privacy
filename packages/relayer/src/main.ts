import { relayerFromEnv } from "./relayer.js";
import { startRelayerServer } from "./server.js";

const port = Number(process.env.PORT ?? "8787");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("invalid PORT");
}
const apiKey = process.env.RELAYER_API_KEY;
if (!apiKey) throw new Error("RELAYER_API_KEY is required");
const host = process.env.HOST ?? "127.0.0.1";
startRelayerServer(relayerFromEnv(process.env), port, { apiKey, host });
