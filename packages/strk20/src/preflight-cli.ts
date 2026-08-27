import { loadStrk20NetworkConfig } from "./config.js";
import {
  preflightStrk20Mainnet,
  preflightStrk20PrivatePaymaster,
} from "./preflight.js";

async function main(): Promise<void> {
  const apiKey = required(
    process.env.AVNU_PAYMASTER_API_KEY,
    "AVNU_PAYMASTER_API_KEY",
  );
  const maximumFeeAmount = parseFeeCap(
    process.env.STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC,
  );
  const [strk20, privatePaymaster] = await Promise.all([
    preflightStrk20Mainnet(loadStrk20NetworkConfig(process.env)),
    preflightStrk20PrivatePaymaster(
      process.env.AVNU_PAYMASTER_URL ?? "https://starknet.paymaster.avnu.fi",
      apiKey,
      maximumFeeAmount,
      required(
        process.env.STRK20_PAYMASTER_PROBE_ACCOUNT,
        "STRK20_PAYMASTER_PROBE_ACCOUNT",
      ),
      fetch,
    ),
  ]);
  process.stdout.write(
    `${JSON.stringify({ ...strk20, privatePaymaster }, null, 2)}\n`,
  );
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseFeeCap(value: string | undefined): bigint {
  if (!value || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(
      "STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC must be USDC base units",
    );
  }
  return BigInt(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`STRK20 preflight failed: ${message}\n`);
  process.exitCode = 1;
});
