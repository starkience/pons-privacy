import { LayerswapClient } from "@pons-privacy/sdk";
import { startDepositServer } from "./deposit-server.js";

const port = Number(process.env.DEPOSIT_API_PORT ?? "8788");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("invalid DEPOSIT_API_PORT");
}
const apiKey = process.env.LAYERSWAP_API_KEY;
if (!apiKey) throw new Error("LAYERSWAP_API_KEY is required");

const layerswap = new LayerswapClient({ apiKey });
const destinationAddress = process.env.STRK20_ACCOUNT_ADDRESS;
startDepositServer(layerswap, port, {
  host: process.env.DEPOSIT_API_HOST ?? "127.0.0.1",
  swapCreationEnabled: process.env.LAYERSWAP_SWAP_CREATION_ENABLED === "true",
  ...(destinationAddress ? { destinationAddress } : {}),
});
