import { createHash } from "node:crypto";
import { OhttpClient } from "@starkware-libs/starknet-privacy-sdk";
import { hash } from "starknet";
import { STRK20_MAINNET } from "./constants.js";
import type { Strk20NetworkConfig } from "./config.js";
import { AvnuPrivatePaymasterGateway } from "./private-paymaster.js";

const REQUEST_TIMEOUT_MS = 10_000;

export interface Strk20PreflightResult {
  readonly chainId: "SN_MAIN";
  readonly specVersion: string;
  readonly blockNumber: number;
  readonly poolClassHash: string;
  readonly poolVersion: "2.0";
  readonly screenerPublicKey: string;
  readonly proofValidityBlocks: number;
  readonly proverSpecVersion: string;
  readonly proverHealthy: true;
  readonly discoveryHealthy: true;
  readonly discoveryLagSeconds: number;
  readonly ohttpTransportHealthy: true;
  readonly ohttpKeySha256: string;
}

export interface Strk20OhttpProbeResult {
  readonly proverSpecVersion: string;
  readonly discoveryStatus: string;
  readonly discoveryLagSeconds: number;
}

export type Strk20OhttpProbe = (
  config: Strk20NetworkConfig,
) => Promise<Strk20OhttpProbeResult>;

export interface Strk20PrivatePaymasterPreflightResult {
  readonly mode: "sponsored_private";
  readonly atomicDepositSupported: true;
  readonly sponsoredAccountDeploymentSupported: true;
  readonly feeToken: string;
  readonly feeRecipient: string;
  readonly feeAmount: string;
  readonly maximumFeeAmount: string;
}

interface JsonRpcResponse<T> {
  readonly result?: T;
  readonly error?: { readonly code: number; readonly message: string };
}

export async function preflightStrk20Mainnet(
  config: Strk20NetworkConfig,
  fetcher: typeof fetch = fetch,
  ohttpProbe: Strk20OhttpProbe = probeStrk20OhttpServices,
): Promise<Strk20PreflightResult> {
  const [
    chainIdHex,
    specVersion,
    blockNumber,
    poolClassHash,
    poolVersionResult,
    screenerPublicKeyResult,
    proofValidityResult,
  ] = await Promise.all([
    rpcCall<string>(config.rpcUrl, "starknet_chainId", [], fetcher),
    rpcCall<string>(config.rpcUrl, "starknet_specVersion", [], fetcher),
    rpcCall<number>(config.rpcUrl, "starknet_blockNumber", [], fetcher),
    rpcCall<string>(
      config.rpcUrl,
      "starknet_getClassHashAt",
      ["latest", config.poolAddress],
      fetcher,
    ),
    poolView(config, "get_version", fetcher),
    poolView(config, "get_screener_public_key", fetcher),
    poolView(config, "get_proof_validity_blocks", fetcher),
  ]);

  if (!sameFelt(chainIdHex, STRK20_MAINNET.chainIdHex)) {
    throw new Error("Starknet RPC is not connected to SN_MAIN");
  }
  if (!sameFelt(poolClassHash, config.poolClassHash)) {
    throw new Error("STRK20 pool class hash does not match the V2 manifest");
  }
  const poolVersion = singleFelt(poolVersionResult, "pool version");
  if (!sameFelt(poolVersion, STRK20_MAINNET.poolVersionFelt)) {
    throw new Error("STRK20 pool does not report version 2.0");
  }
  const screenerPublicKey = singleFelt(
    screenerPublicKeyResult,
    "screener public key",
  );
  if (!sameFelt(screenerPublicKey, STRK20_MAINNET.screenerPublicKey)) {
    throw new Error("STRK20 screener public key changed");
  }
  const proofValidityBlocks = Number(
    BigInt(singleFelt(proofValidityResult, "proof validity blocks")),
  );
  if (proofValidityBlocks !== STRK20_MAINNET.proofValidityBlocks) {
    throw new Error("STRK20 proof-validity window changed");
  }

  const [proverKeys, discoveryKeys] = await Promise.all([
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
  if (ohttpKeySha256 !== STRK20_MAINNET.ohttpPublicKeyConfigSha256) {
    throw new Error("STRK20 OHTTP key pin hash is inconsistent");
  }

  let ohttp: Strk20OhttpProbeResult;
  try {
    ohttp = await ohttpProbe(config);
  } catch {
    throw new Error("STRK20 pinned OHTTP service probe failed");
  }
  if (ohttp.proverSpecVersion !== STRK20_MAINNET.proverSpecVersion) {
    throw new Error("STRK20 prover spec version changed");
  }
  if (ohttp.discoveryStatus.toLowerCase() !== "ok") {
    throw new Error("STRK20 discovery service is not healthy over OHTTP");
  }
  if (
    !Number.isSafeInteger(ohttp.discoveryLagSeconds) ||
    ohttp.discoveryLagSeconds < 0 ||
    ohttp.discoveryLagSeconds > 120
  ) {
    throw new Error("STRK20 discovery service is more than 120 seconds behind");
  }

  return {
    chainId: "SN_MAIN",
    specVersion,
    blockNumber,
    poolClassHash,
    poolVersion: "2.0",
    screenerPublicKey,
    proofValidityBlocks,
    proverSpecVersion: ohttp.proverSpecVersion,
    proverHealthy: true,
    discoveryHealthy: true,
    discoveryLagSeconds: ohttp.discoveryLagSeconds,
    ohttpTransportHealthy: true,
    ohttpKeySha256,
  };
}

export async function probeStrk20OhttpServices(
  config: Strk20NetworkConfig,
): Promise<Strk20OhttpProbeResult> {
  const options = { publicKeyConfig: config.ohttpPublicKeyConfig };
  const prover = new OhttpClient(config.provingServiceUrl, options);
  const discovery = new OhttpClient(config.discoveryServiceUrl, options);
  const [proverResponse, discoveryHealth] = await Promise.all([
    prover.post<JsonRpcResponse<string>>("", {
      jsonrpc: "2.0",
      id: 1,
      method: "starknet_specVersion",
      params: [],
    }),
    discovery.get<{
      readonly status?: unknown;
      readonly lag_secs?: unknown;
    }>("/health"),
  ]);
  if (proverResponse.error || typeof proverResponse.result !== "string") {
    throw new Error("prover returned no spec version over OHTTP");
  }
  if (
    typeof discoveryHealth.status !== "string" ||
    typeof discoveryHealth.lag_secs !== "number"
  ) {
    throw new Error("discovery returned invalid health over OHTTP");
  }
  return {
    proverSpecVersion: proverResponse.result,
    discoveryStatus: discoveryHealth.status,
    discoveryLagSeconds: discoveryHealth.lag_secs,
  };
}

export async function preflightStrk20PrivatePaymaster(
  endpoint: string,
  apiKey: string,
  maximumFeeAmount: bigint,
  probeAccountAddress: string,
  fetcher: typeof fetch = fetch,
): Promise<Strk20PrivatePaymasterPreflightResult> {
  if (!apiKey) throw new Error("AVNU_PAYMASTER_API_KEY is required");
  if (maximumFeeAmount < 0n) {
    throw new Error("STRK20 private paymaster fee cap must not be negative");
  }
  const authenticatedFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-paymaster-api-key", apiKey);
    return fetcher(input, { ...init, headers });
  };
  const gateway = new AvnuPrivatePaymasterGateway(endpoint, authenticatedFetch);
  let build;
  try {
    build = await gateway.buildInvokeAndPoolAction(
      STRK20_MAINNET.poolAddress,
      STRK20_MAINNET.usdcAddress,
      probeAccountAddress,
      [
        {
          contractAddress: STRK20_MAINNET.usdcAddress,
          entrypoint: "approve",
          calldata: [STRK20_MAINNET.poolAddress, "1", "0"],
        },
      ],
    );
  } catch (error) {
    throw new Error("AVNU atomic STRK20 deposit build is unavailable", {
      cause: error,
    });
  }
  const fee = build.feeAction;
  if (!fee) throw new Error("AVNU returned no private pool fee action");
  if (!sameFelt(fee.token, STRK20_MAINNET.usdcAddress)) {
    throw new Error("AVNU private pool fee token is not pinned USDC");
  }
  if (fee.amount > maximumFeeAmount) {
    throw new Error("AVNU private pool fee exceeds the configured maximum");
  }
  try {
    await preflightSponsoredDeployment(endpoint, authenticatedFetch);
  } catch (error) {
    throw new Error("AVNU sponsored S1 deployment build is unavailable", {
      cause: error,
    });
  }
  return {
    mode: "sponsored_private",
    atomicDepositSupported: true,
    sponsoredAccountDeploymentSupported: true,
    feeToken: fee.token,
    feeRecipient: fee.recipient,
    feeAmount: fee.amount.toString(),
    maximumFeeAmount: maximumFeeAmount.toString(),
  };
}

async function preflightSponsoredDeployment(
  endpoint: string,
  fetcher: typeof fetch,
): Promise<void> {
  const publicKey = "0x1";
  const address = preflightAccountAddress();
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "paymaster_buildTransaction",
      params: {
        transaction: {
          type: "deploy",
          deployment: {
            address,
            class_hash: STRK20_MAINNET.ozAccountClassHash,
            salt: publicKey,
            calldata: [publicKey],
            version: 1,
          },
        },
        parameters: {
          version: "0x1",
          fee_mode: { mode: "sponsored" },
        },
      },
    }),
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await response.json()) as JsonRpcResponse<{
    readonly type?: unknown;
  }>;
  if (!response.ok || body.error || body.result?.type !== "deploy") {
    throw new Error("AVNU sponsored S1 deployment is unavailable");
  }
}

function preflightAccountAddress(): string {
  const publicKey = "0x1";
  return hash.calculateContractAddressFromHash(
    publicKey,
    STRK20_MAINNET.ozAccountClassHash,
    [publicKey],
    0,
  );
}

async function poolView(
  config: Strk20NetworkConfig,
  functionName: string,
  fetcher: typeof fetch,
): Promise<readonly string[]> {
  return rpcCall<readonly string[]>(
    config.rpcUrl,
    "starknet_call",
    [
      {
        contract_address: config.poolAddress,
        entry_point_selector: hash.getSelectorFromName(functionName),
        calldata: [],
      },
      "latest",
    ],
    fetcher,
  );
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

function singleFelt(value: readonly string[], field: string): string {
  if (
    value.length !== 1 ||
    typeof value[0] !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(value[0])
  ) {
    throw new Error(`STRK20 ${field} returned invalid data`);
  }
  return value[0];
}

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}
