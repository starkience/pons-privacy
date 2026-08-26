import { MAX_VIEWING_KEY } from "@starkware-libs/starknet-privacy-sdk";
import { ec, validateAndParseAddress } from "starknet";
import { STRK20_MAINNET_RC4 } from "./constants.js";

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;

export interface Strk20NetworkConfig {
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly poolClassHash: string;
  readonly provingServiceUrl: string;
  readonly discoveryServiceUrl: string;
  readonly ohttpPublicKeyConfig: Uint8Array;
}

export interface Strk20CustodianConfig extends Strk20NetworkConfig {
  readonly accountAddress: string;
  readonly accountPrivateKey: string;
  readonly viewingKey: bigint;
  readonly usdcAddress: string;
}

export function loadStrk20NetworkConfig(
  env: NodeJS.ProcessEnv,
): Strk20NetworkConfig {
  return {
    rpcUrl: requireHttpsUrl(env.STARKNET_RPC_URL, "STARKNET_RPC_URL"),
    poolAddress: STRK20_MAINNET_RC4.poolAddress,
    poolClassHash: STRK20_MAINNET_RC4.poolClassHash,
    provingServiceUrl: STRK20_MAINNET_RC4.provingServiceUrl,
    discoveryServiceUrl: STRK20_MAINNET_RC4.discoveryServiceUrl,
    ohttpPublicKeyConfig: Uint8Array.from(
      Buffer.from(STRK20_MAINNET_RC4.ohttpPublicKeyConfigBase64, "base64"),
    ),
  };
}

export function loadStrk20CustodianConfig(
  env: NodeJS.ProcessEnv,
): Strk20CustodianConfig {
  const network = loadStrk20NetworkConfig(env);
  const accountAddress = requireStarknetAddress(
    env.STRK20_ACCOUNT_ADDRESS,
    "STRK20_ACCOUNT_ADDRESS",
  );
  const accountPrivateKey = required(
    env.STRK20_ACCOUNT_PRIVATE_KEY,
    "STRK20_ACCOUNT_PRIVATE_KEY",
  );
  if (!PRIVATE_KEY_PATTERN.test(accountPrivateKey)) {
    throw new Error("STRK20_ACCOUNT_PRIVATE_KEY must be a Starknet hex key");
  }
  const privateKeyValue = BigInt(accountPrivateKey);
  if (privateKeyValue < 1n || privateKeyValue >= ec.starkCurve.CURVE.n) {
    throw new Error("STRK20_ACCOUNT_PRIVATE_KEY is outside the curve range");
  }
  const viewingKey = parseViewingKey(env.STRK20_VIEWING_KEY);
  const usdcAddress = requireStarknetAddress(
    env.STRK20_USDC_ADDRESS,
    "STRK20_USDC_ADDRESS",
  );
  return {
    ...network,
    accountAddress,
    accountPrivateKey,
    viewingKey,
    usdcAddress,
  };
}

export function requireStarknetAddress(
  value: string | undefined,
  name: string,
): string {
  const raw = required(value, name);
  let result: string;
  try {
    result = validateAndParseAddress(raw);
  } catch {
    throw new Error(`${name} must be a valid Starknet address`);
  }
  if (BigInt(result) === 0n) throw new Error(`${name} must not be zero`);
  return result;
}

function parseViewingKey(value: string | undefined): bigint {
  const raw = required(value, "STRK20_VIEWING_KEY");
  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    throw new Error("STRK20_VIEWING_KEY must be a decimal or 0x bigint");
  }
  if (parsed < 1n || parsed > MAX_VIEWING_KEY) {
    throw new Error("STRK20_VIEWING_KEY is outside the supported curve range");
  }
  return parsed;
}

function requireHttpsUrl(value: string | undefined, name: string): string {
  const raw = required(value, name);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
  return parsed.toString();
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}
