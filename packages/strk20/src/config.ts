import { validateAndParseAddress } from "starknet";
import { STRK20_MAINNET_RC4 } from "./constants.js";

export interface Strk20NetworkConfig {
  readonly rpcUrl: string;
  readonly poolAddress: string;
  readonly poolClassHash: string;
  readonly provingServiceUrl: string;
  readonly discoveryServiceUrl: string;
  readonly ohttpPublicKeyConfig: Uint8Array;
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
