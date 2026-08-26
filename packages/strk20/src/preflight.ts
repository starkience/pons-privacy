import { createHash } from "node:crypto";
import { STRK20_MAINNET_RC4 } from "./constants.js";
import type { Strk20NetworkConfig } from "./config.js";

const REQUEST_TIMEOUT_MS = 10_000;

export interface Strk20PreflightResult {
  readonly chainId: "SN_MAIN";
  readonly specVersion: string;
  readonly blockNumber: number;
  readonly poolClassHash: string;
  readonly proverHealthy: true;
  readonly discoveryHealthy: true;
  readonly discoveryLagSeconds: number;
  readonly ohttpKeySha256: string;
}

interface JsonRpcResponse<T> {
  readonly result?: T;
  readonly error?: { readonly code: number; readonly message: string };
}

export async function preflightStrk20Mainnet(
  config: Strk20NetworkConfig,
  fetcher: typeof fetch = fetch,
): Promise<Strk20PreflightResult> {
  const [chainIdHex, specVersion, blockNumber, poolClassHash] =
    await Promise.all([
      rpcCall<string>(config.rpcUrl, "starknet_chainId", [], fetcher),
      rpcCall<string>(config.rpcUrl, "starknet_specVersion", [], fetcher),
      rpcCall<number>(config.rpcUrl, "starknet_blockNumber", [], fetcher),
      rpcCall<string>(
        config.rpcUrl,
        "starknet_getClassHashAt",
        ["latest", config.poolAddress],
        fetcher,
      ),
    ]);

  if (chainIdHex.toLowerCase() !== STRK20_MAINNET_RC4.chainIdHex) {
    throw new Error("Starknet RPC is not connected to SN_MAIN");
  }
  if (poolClassHash.toLowerCase() !== config.poolClassHash.toLowerCase()) {
    throw new Error("STRK20 pool class hash does not match the RC.4 manifest");
  }

  const [proverHealth, discoveryHealth, proverKeys, discoveryKeys] =
    await Promise.all([
      getJson<{ status: string }>(
        new URL("health", config.provingServiceUrl),
        "prover health",
        fetcher,
      ),
      getJson<{ status: string; lag_secs?: number }>(
        new URL("health", config.discoveryServiceUrl),
        "discovery health",
        fetcher,
      ),
      getBytes(
        new URL("ohttp-keys", config.provingServiceUrl),
        "prover OHTTP keys",
        fetcher,
      ),
      getBytes(
        new URL("ohttp-keys", config.discoveryServiceUrl),
        "discovery OHTTP keys",
        fetcher,
      ),
    ]);

  if (proverHealth.status.toLowerCase() !== "ok") {
    throw new Error("STRK20 prover is not healthy");
  }
  if (discoveryHealth.status.toLowerCase() !== "ok") {
    throw new Error("STRK20 discovery service is not healthy");
  }
  const discoveryLagSeconds = discoveryHealth.lag_secs ?? Number.MAX_VALUE;
  if (discoveryLagSeconds > 120) {
    throw new Error("STRK20 discovery service is more than 120 seconds behind");
  }
  const expectedKeys = Buffer.from(config.ohttpPublicKeyConfig);
  if (
    !Buffer.from(proverKeys).equals(expectedKeys) ||
    !Buffer.from(discoveryKeys).equals(expectedKeys)
  ) {
    throw new Error("STRK20 OHTTP key pin changed");
  }
  const ohttpKeySha256 = createHash("sha256")
    .update(expectedKeys)
    .digest("hex");
  if (ohttpKeySha256 !== STRK20_MAINNET_RC4.ohttpPublicKeyConfigSha256) {
    throw new Error("STRK20 OHTTP key pin hash is inconsistent");
  }

  return {
    chainId: "SN_MAIN",
    specVersion,
    blockNumber,
    poolClassHash,
    proverHealthy: true,
    discoveryHealthy: true,
    discoveryLagSeconds,
    ohttpKeySha256,
  };
}

async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Starknet RPC request failed for ${method}`);
  }
  if (!response.ok) {
    throw new Error(`Starknet RPC returned HTTP ${response.status}`);
  }
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error || payload.result === undefined) {
    throw new Error(`Starknet RPC rejected ${method}`);
  }
  return payload.result;
}

async function getJson<T>(
  url: URL,
  label: string,
  fetcher: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`STRK20 ${label} request failed`);
  }
  if (!response.ok) throw new Error(`STRK20 ${label} returned an error`);
  return (await response.json()) as T;
}

async function getBytes(
  url: URL,
  label: string,
  fetcher: typeof fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`STRK20 ${label} request failed`);
  }
  if (!response.ok) throw new Error(`STRK20 ${label} returned an error`);
  return new Uint8Array(await response.arrayBuffer());
}
