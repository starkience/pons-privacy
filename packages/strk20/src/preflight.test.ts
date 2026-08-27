import { createHash } from "node:crypto";
import { hash } from "starknet";
import { describe, expect, it, vi } from "vitest";
import { loadStrk20NetworkConfig } from "./config.js";
import { STRK20_MAINNET } from "./constants.js";
import {
  preflightStrk20Mainnet,
  preflightStrk20PrivatePaymaster,
  type Strk20OhttpProbe,
} from "./preflight.js";

const config = loadStrk20NetworkConfig({
  STARKNET_RPC_URL: "https://rpc.example/redacted",
});

const healthyOhttpProbe: Strk20OhttpProbe = vi.fn(async () => ({
  proverSpecVersion: STRK20_MAINNET.proverSpecVersion,
  discoveryStatus: "OK",
  discoveryLagSeconds: 5,
}));

function rpcFetcher(ohttpKeys = config.ohttpPublicKeyConfig): typeof fetch {
  return vi.fn(async (_input: string | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as {
        method: string;
        params: readonly unknown[];
      };
      const result: Record<string, unknown> = {
        starknet_chainId: STRK20_MAINNET.chainIdHex,
        starknet_specVersion: "0.10.0",
        starknet_blockNumber: 123,
        starknet_getClassHashAt: STRK20_MAINNET.poolClassHash,
      };
      if (body.method === "starknet_call") {
        const request = body.params[0] as { entry_point_selector: string };
        const views: Record<string, readonly string[]> = {
          [hash.getSelectorFromName("get_version")]: [
            STRK20_MAINNET.poolVersionFelt,
          ],
          [hash.getSelectorFromName("get_screener_public_key")]: [
            STRK20_MAINNET.screenerPublicKey,
          ],
          [hash.getSelectorFromName("get_proof_validity_blocks")]: [
            `0x${STRK20_MAINNET.proofValidityBlocks.toString(16)}`,
          ],
        };
        result.starknet_call = views[request.entry_point_selector];
      }
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: result[body.method],
      });
    }
    return new Response(ohttpKeys.buffer as ArrayBuffer, { status: 200 });
  }) as unknown as typeof fetch;
}

describe("STRK20 mainnet preflight", () => {
  it("verifies V2, screening, services, lag, and real pinned-OHTTP transport", async () => {
    const result = await preflightStrk20Mainnet(
      config,
      rpcFetcher(),
      healthyOhttpProbe,
    );
    expect(result).toMatchObject({
      chainId: "SN_MAIN",
      poolVersion: "2.0",
      proofValidityBlocks: 450,
      proverSpecVersion: STRK20_MAINNET.proverSpecVersion,
      discoveryLagSeconds: 5,
      ohttpTransportHealthy: true,
    });
    expect(result.ohttpKeySha256).toBe(
      createHash("sha256").update(config.ohttpPublicKeyConfig).digest("hex"),
    );
  });

  it("rejects a changed OHTTP key before using the service", async () => {
    const probe = vi.fn(healthyOhttpProbe);
    await expect(
      preflightStrk20Mainnet(
        config,
        rpcFetcher(new Uint8Array([1, 2, 3])),
        probe,
      ),
    ).rejects.toThrow("OHTTP key pin changed");
    expect(probe).not.toHaveBeenCalled();
  });

  it("rejects a prover version outside the verified release set", async () => {
    await expect(
      preflightStrk20Mainnet(config, rpcFetcher(), async () => ({
        proverSpecVersion: "0.10.4",
        discoveryStatus: "OK",
        discoveryLagSeconds: 5,
      })),
    ).rejects.toThrow("prover spec version changed");
  });

  it("verifies AVNU private pool support and the configured USDC fee cap", async () => {
    const fetcher = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("x-paymaster-api-key")).toBe(
        "server-secret",
      );
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          fee_action: {
            type: "withdraw",
            recipient: "0x123",
            token: STRK20_MAINNET.usdcAddress,
            amount: "187732",
          },
        },
      });
    }) as unknown as typeof fetch;
    await expect(
      preflightStrk20PrivatePaymaster(
        "https://paymaster.example",
        "server-secret",
        500_000n,
        fetcher,
      ),
    ).resolves.toMatchObject({
      mode: "sponsored_private",
      feeAmount: "187732",
      maximumFeeAmount: "500000",
    });
  });
});
