import { describe, expect, it } from "vitest";
import {
  loadStrk20CustodianConfig,
  loadStrk20NetworkConfig,
} from "./config.js";

const completeEnv: NodeJS.ProcessEnv = {
  STARKNET_RPC_URL: "https://starknet-mainnet.example/rpc/redacted",
  STRK20_ACCOUNT_ADDRESS: "0x123",
  STRK20_ACCOUNT_PRIVATE_KEY: "0x456",
  STRK20_VIEWING_KEY: "0x789",
  STRK20_USDC_ADDRESS: "0xabc",
};

describe("STRK20 configuration", () => {
  it("loads project-held mainnet secrets without changing public pins", () => {
    const config = loadStrk20CustodianConfig(completeEnv);
    expect(config.accountAddress).toMatch(/0123$/);
    expect(config.viewingKey).toBe(0x789n);
    expect(config.poolAddress).toMatch(/^0x/);
    expect(config.ohttpPublicKeyConfig).toHaveLength(43);
  });

  it("rejects non-HTTPS RPC endpoints", () => {
    expect(() =>
      loadStrk20NetworkConfig({ STARKNET_RPC_URL: "http://127.0.0.1" }),
    ).toThrow("must use HTTPS");
  });

  it("rejects malformed viewing keys without reflecting them", () => {
    expect(() =>
      loadStrk20CustodianConfig({
        ...completeEnv,
        STRK20_VIEWING_KEY: "not-a-key",
      }),
    ).toThrow("must be a decimal or 0x bigint");
  });

  it("accepts padded Starknet addresses and rejects zero", () => {
    expect(
      loadStrk20CustodianConfig({
        ...completeEnv,
        STRK20_ACCOUNT_ADDRESS: "0x0123",
      }).accountAddress,
    ).toMatch(/0123$/);
    expect(() =>
      loadStrk20CustodianConfig({
        ...completeEnv,
        STRK20_USDC_ADDRESS: "0x0",
      }),
    ).toThrow("must not be zero");
  });
});
