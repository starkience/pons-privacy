import { createHttpRelay, LayerswapClient } from "@pons-privacy/sdk";
import { startDepositServer } from "./deposit-server.js";
import { FileSwapOperationStore } from "./swap-operation-store.js";

const port = Number(process.env.DEPOSIT_API_PORT ?? "8788");
if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("invalid DEPOSIT_API_PORT");
}
const apiKey = process.env.LAYERSWAP_API_KEY;
if (!apiKey) throw new Error("LAYERSWAP_API_KEY is required");

const layerswap = new LayerswapClient({ apiKey });
const paymasterApiKey = process.env.AVNU_PAYMASTER_API_KEY;
const operationStorePath =
  process.env.LAYERSWAP_OPERATION_STORE_PATH ??
  ".data/layerswap-operations.json";
startDepositServer(layerswap, port, {
  host: process.env.DEPOSIT_API_HOST ?? "127.0.0.1",
  swapCreationEnabled: process.env.LAYERSWAP_SWAP_CREATION_ENABLED === "true",
  fundingSwapCreationEnabled:
    process.env.LAYERSWAP_OUTBOUND_SWAP_CREATION_ENABLED === "true",
  operationStore: new FileSwapOperationStore(operationStorePath),
  ...(process.env.RELAYER_API_KEY
    ? {
        evmRelay: createHttpRelay({
          endpoint:
            process.env.RELAY_ENDPOINT ?? "http://127.0.0.1:8787/v1/relay",
          apiKey: process.env.RELAYER_API_KEY,
        }),
      }
    : {}),
  ...(process.env.STARKNET_RPC_URL
    ? { starknetRpc: { endpoint: process.env.STARKNET_RPC_URL } }
    : {}),
  ...(paymasterApiKey
    ? {
        paymaster: {
          apiKey: paymasterApiKey,
          endpoint:
            process.env.AVNU_PAYMASTER_URL ??
            "https://starknet.paymaster.avnu.fi",
        },
      }
    : {}),
});
