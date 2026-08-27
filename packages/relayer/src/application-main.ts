import {
  createHttpRelay,
  robinhood,
  type RelayExecution,
} from "@pons-privacy/sdk";
import { createPublicClient, http } from "viem";
import { PonsLaunchApplication } from "./launch-application.js";
import { FileLaunchApplicationStore } from "./launch-application-store.js";
import { startLaunchServer } from "./launch-server.js";
import { PonsTradeApplication } from "./trade-application.js";
import { FileTradeApplicationStore } from "./trade-application-store.js";

const port = portNumber(process.env.APP_API_PORT ?? "8789", "APP_API_PORT");
const submissionEnabled = process.env.LAUNCH_SUBMISSION_ENABLED === "true";
const tradeSubmissionEnabled = process.env.TRADE_SUBMISSION_ENABLED === "true";
const relay: RelayExecution =
  submissionEnabled || tradeSubmissionEnabled
    ? createHttpRelay({
        endpoint: required(process.env.RELAY_ENDPOINT, "RELAY_ENDPOINT"),
        apiKey: required(process.env.RELAYER_API_KEY, "RELAYER_API_KEY"),
      })
    : async () => {
        throw new Error("mainnet launch submission is disabled");
      };
const publicClient = createPublicClient({
  chain: robinhood,
  transport: http(
    process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
  ),
});
const store = new FileLaunchApplicationStore(
  process.env.LAUNCH_OPERATION_STORE_PATH ?? ".data/launch-operations.json",
);
const application = new PonsLaunchApplication({
  publicClient,
  relay,
  store,
  submissionEnabled,
});
const tradeApplication = new PonsTradeApplication({
  publicClient,
  relay,
  store: new FileTradeApplicationStore(
    process.env.TRADE_OPERATION_STORE_PATH ?? ".data/trade-operations.json",
  ),
  submissionEnabled: tradeSubmissionEnabled,
});
startLaunchServer(application, port, {
  host: process.env.APP_API_HOST ?? "127.0.0.1",
  submissionEnabled,
  tradeApplication,
  tradeSubmissionEnabled,
  ...(process.env.APP_API_ALLOWED_ORIGIN
    ? { allowedOrigin: process.env.APP_API_ALLOWED_ORIGIN }
    : {}),
});

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function portNumber(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`${name} must be a valid port`);
  }
  return parsed;
}
