import { describe, expect, it, vi } from "vitest";
import { forwardStarknetRpcRequest } from "./starknet-rpc-proxy.js";

const options = {
  endpoint: "https://starknet.example/rpc/server-credential",
};

describe("Starknet RPC proxy", () => {
  it("forwards an allowlisted read without exposing the endpoint", async () => {
    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe(options.endpoint);
        expect(JSON.parse(String(init?.body))).toMatchObject({
          method: "starknet_blockNumber",
        });
        return Response.json({ jsonrpc: "2.0", id: 1, result: 123 });
      },
    );
    const response = await forwardStarknetRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "starknet_blockNumber",
        params: [],
      },
      options,
      fetchMock,
    );
    expect(response).toMatchObject({ status: 200, body: { result: 123 } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects batches and every transaction-submission method", async () => {
    const fetchMock = vi.fn();
    await expect(
      forwardStarknetRpcRequest([], options, fetchMock),
    ).resolves.toMatchObject({ status: 400 });
    await expect(
      forwardStarknetRpcRequest(
        {
          jsonrpc: "2.0",
          id: 7,
          method: "starknet_addInvokeTransaction",
          params: [],
        },
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
