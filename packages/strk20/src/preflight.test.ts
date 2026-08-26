import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { loadStrk20NetworkConfig } from "./config.js";
import { STRK20_MAINNET_RC4 } from "./constants.js";
import { preflightStrk20Mainnet } from "./preflight.js";

const config = loadStrk20NetworkConfig({
  STARKNET_RPC_URL: "https://rpc.example/redacted",
});

describe("STRK20 mainnet preflight", () => {
  it("verifies chain, pool, services, lag, and the pinned OHTTP key", async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { method: string };
        const result: Record<string, unknown> = {
          starknet_chainId: STRK20_MAINNET_RC4.chainIdHex,
          starknet_specVersion: "0.10.0",
          starknet_blockNumber: 123,
          starknet_getClassHashAt: STRK20_MAINNET_RC4.poolClassHash,
        };
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: result[body.method],
        });
      }
      const url = String(input);
      if (url.endsWith("/health")) {
        return Response.json(
          url.includes("discovery")
            ? { status: "OK", lag_secs: 5 }
            : { status: "ok" },
        );
      }
      return new Response(config.ohttpPublicKeyConfig.buffer as ArrayBuffer, {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await preflightStrk20Mainnet(config, fetcher);
    expect(result.chainId).toBe("SN_MAIN");
    expect(result.discoveryLagSeconds).toBe(5);
    expect(result.ohttpKeySha256).toBe(
      createHash("sha256").update(config.ohttpPublicKeyConfig).digest("hex"),
    );
  });

  it("rejects a changed OHTTP key", async () => {
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { method: string };
        const result: Record<string, unknown> = {
          starknet_chainId: STRK20_MAINNET_RC4.chainIdHex,
          starknet_specVersion: "0.10.0",
          starknet_blockNumber: 123,
          starknet_getClassHashAt: STRK20_MAINNET_RC4.poolClassHash,
        };
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: result[body.method],
        });
      }
      const url = String(input);
      if (url.endsWith("/health")) {
        return Response.json(
          url.includes("discovery")
            ? { status: "OK", lag_secs: 5 }
            : { status: "ok" },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(preflightStrk20Mainnet(config, fetcher)).rejects.toThrow(
      "OHTTP key pin changed",
    );
  });
});
