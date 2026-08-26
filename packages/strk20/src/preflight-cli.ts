import { loadStrk20NetworkConfig } from "./config.js";
import { preflightStrk20Mainnet } from "./preflight.js";

async function main(): Promise<void> {
  const result = await preflightStrk20Mainnet(
    loadStrk20NetworkConfig(process.env),
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`STRK20 preflight failed: ${message}\n`);
  process.exitCode = 1;
});
