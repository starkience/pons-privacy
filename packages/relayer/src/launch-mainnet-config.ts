import type { Hex } from "viem";

const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
const DEFAULT_RELAY_ENDPOINT = "http://127.0.0.1:8787/v1/relay";

export interface LaunchMainnetConfig {
  readonly ownerPrivateKey: Hex;
  readonly relayerApiKey: string;
  readonly rpcUrl: string;
  readonly relayEndpoint: string;
  readonly broadcast: boolean;
  readonly name: string;
  readonly symbol: string;
  readonly logo: string | undefined;
  readonly description: string | undefined;
  readonly twitter: string | undefined;
  readonly telegram: string | undefined;
  readonly discord: string | undefined;
  readonly website: string | undefined;
  readonly farcaster: string | undefined;
  readonly creatorTaxBps: number;
  readonly buybackEnabled: boolean;
  readonly launchConfigId: bigint;
  readonly salt: Hex;
}

export function launchMainnetConfig(
  env: NodeJS.ProcessEnv,
): LaunchMainnetConfig {
  const ownerPrivateKey = required(
    env.LAUNCH_OWNER_PRIVATE_KEY,
    "LAUNCH_OWNER_PRIVATE_KEY",
  );
  if (!/^0x[0-9a-fA-F]{64}$/.test(ownerPrivateKey)) {
    throw new Error("LAUNCH_OWNER_PRIVATE_KEY must be a 32-byte hex key");
  }
  const relayerApiKey = required(env.RELAYER_API_KEY, "RELAYER_API_KEY");
  if (Buffer.byteLength(relayerApiKey) < 32) {
    throw new Error("RELAYER_API_KEY must contain at least 32 bytes");
  }
  const salt = required(env.TOKEN_SALT, "TOKEN_SALT");
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) {
    throw new Error("TOKEN_SALT must be 32-byte hex");
  }
  return {
    ownerPrivateKey: ownerPrivateKey as Hex,
    relayerApiKey,
    rpcUrl: env.RPC_URL?.trim() || DEFAULT_RPC_URL,
    relayEndpoint: env.RELAY_ENDPOINT?.trim() || DEFAULT_RELAY_ENDPOINT,
    broadcast: boolean(env.BROADCAST, "BROADCAST", false),
    name: required(env.TOKEN_NAME, "TOKEN_NAME").trim(),
    symbol: required(env.TOKEN_SYMBOL, "TOKEN_SYMBOL").trim(),
    logo: optional(env.TOKEN_LOGO),
    description: optional(env.TOKEN_DESCRIPTION),
    twitter: optional(env.TOKEN_TWITTER),
    telegram: optional(env.TOKEN_TELEGRAM),
    discord: optional(env.TOKEN_DISCORD),
    website: optional(env.TOKEN_WEBSITE),
    farcaster: optional(env.TOKEN_FARCASTER),
    creatorTaxBps: integer(
      env.CREATOR_TAX_BPS ?? "0",
      "CREATOR_TAX_BPS",
      0,
      10_000,
    ),
    buybackEnabled: boolean(env.BUYBACK_ENABLED, "BUYBACK_ENABLED", false),
    launchConfigId: unsignedBigInt(
      env.LAUNCH_CONFIG_ID ?? "0",
      "LAUNCH_CONFIG_ID",
    ),
    salt: salt as Hex,
  };
}

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function boolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function integer(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function unsignedBigInt(value: string, name: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
  return BigInt(value);
}
