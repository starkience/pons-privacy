import { describe, expect, it } from "vitest";
import { loadStrk20NetworkConfig, requireStarknetAddress } from "./config.js";

const completeEnv: NodeJS.ProcessEnv = {
  STARKNET_RPC_URL: "https://starknet-mainnet.example/rpc/redacted",
};

describe("STRK20 configuration", () => {
  it("loads public network pins without requiring user key material", () => {
    const config = loadStrk20NetworkConfig(completeEnv);
    expect(config.poolAddress).toMatch(/^0x/);
    expect(config.ohttpPublicKeyConfig).toHaveLength(43);
  });

  it("rejects non-HTTPS RPC endpoints", () => {
    expect(() =>
      loadStrk20NetworkConfig({ STARKNET_RPC_URL: "http://127.0.0.1" }),
    ).toThrow("must use HTTPS");
  });

  it("accepts padded Starknet addresses and rejects zero", () => {
    expect(requireStarknetAddress("0x0123", "address")).toMatch(/0123$/);
    expect(() => requireStarknetAddress("0x0", "address")).toThrow(
      "must not be zero",
    );
  });
});
