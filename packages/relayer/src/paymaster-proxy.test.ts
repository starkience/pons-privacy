import { describe, expect, it, vi } from "vitest";
import { forwardAvnuPaymasterRequest } from "./paymaster-proxy.js";

const options = { apiKey: "server-secret" };

describe("AVNU paymaster proxy", () => {
  it("injects the server credential for an allowlisted method", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("x-paymaster-api-key")).toBe(
          "server-secret",
        );
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const response = await forwardAvnuPaymasterRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "paymaster_buildTransaction",
        params: {},
      },
      options,
      fetchMock,
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects batches and unrelated JSON-RPC methods without forwarding", async () => {
    const fetchMock = vi.fn();
    await expect(
      forwardAvnuPaymasterRequest([], options, fetchMock),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      forwardAvnuPaymasterRequest(
        { id: 7, method: "starknet_addInvokeTransaction" },
        options,
        fetchMock,
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: { error: { code: -32601 } },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
