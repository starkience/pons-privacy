export const ALLOWED_STARKNET_RPC_METHODS: ReadonlySet<string> = new Set([
  "starknet_blockNumber",
  "starknet_call",
  "starknet_chainId",
  "starknet_getBlockWithTxHashes",
  "starknet_getClassAt",
  "starknet_getClassHashAt",
  "starknet_getNonce",
  "starknet_getStorageAt",
  "starknet_getTransactionReceipt",
  "starknet_getTransactionStatus",
  "starknet_specVersion",
  "starknet_syncing",
]);

export interface StarknetRpcProxyOptions {
  readonly endpoint: string;
}

export interface StarknetRpcProxyResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Keeps the Starknet provider credential out of the browser bundle. Only
 * read-only methods needed by the Privacy SDK and receipt polling are exposed;
 * transaction submission is deliberately left to the AVNU paymaster.
 */
export async function forwardStarknetRpcRequest(
  body: unknown,
  options: StarknetRpcProxyOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<StarknetRpcProxyResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(null, -32600, "single JSON-RPC request required", 400);
  }
  const request = body as Record<string, unknown>;
  const id =
    typeof request.id === "string" || typeof request.id === "number"
      ? request.id
      : null;
  if (
    request.jsonrpc !== "2.0" ||
    typeof request.method !== "string" ||
    !ALLOWED_STARKNET_RPC_METHODS.has(request.method)
  ) {
    return rpcError(
      id,
      -32601,
      "method not allowed by the Starknet RPC proxy",
      403,
    );
  }
  const response = await fetchImpl(httpsUrl(options.endpoint), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(30_000),
  });
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    return rpcError(id, -32603, "Starknet RPC returned invalid JSON", 502);
  }
  return { status: response.status, body: responseBody };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  status: number,
): StarknetRpcProxyResponse {
  return {
    status,
    body: { jsonrpc: "2.0", id, error: { code, message } },
  };
}

function httpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Starknet RPC endpoint must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Starknet RPC endpoint must use HTTPS");
  }
  return parsed.href;
}
