import { describe, expect, it } from "vitest";
import { launchMainnetConfig } from "./launch-mainnet-config.js";

const valid = {
  LAUNCH_OWNER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  RELAYER_API_KEY: "test-relayer-api-key-with-at-least-32-bytes",
  TOKEN_NAME: "Pons Privacy",
  TOKEN_SYMBOL: "PONS",
  TOKEN_SALT: `0x${"22".repeat(32)}`,
};

describe("mainnet launch configuration", () => {
  it("defaults to a non-broadcasting config 0 launch", () => {
    expect(launchMainnetConfig(valid)).toMatchObject({
      broadcast: false,
      creatorTaxBps: 0,
      buybackEnabled: false,
      launchConfigId: 0n,
    });
  });

  it("accepts an explicitly broadcasting launch", () => {
    expect(
      launchMainnetConfig({
        ...valid,
        BROADCAST: "true",
        CREATOR_TAX_BPS: "500",
        BUYBACK_ENABLED: "true",
      }),
    ).toMatchObject({
      broadcast: true,
      creatorTaxBps: 500,
      buybackEnabled: true,
    });
  });

  it("rejects malformed safety-critical values", () => {
    expect(() => launchMainnetConfig({ ...valid, BROADCAST: "yes" })).toThrow(
      /true or false/,
    );
    expect(() => launchMainnetConfig({ ...valid, TOKEN_SALT: "0x12" })).toThrow(
      /32-byte hex/,
    );
    expect(() =>
      launchMainnetConfig({ ...valid, CREATOR_TAX_BPS: "10001" }),
    ).toThrow(/between 0 and 10000/);
  });
});
