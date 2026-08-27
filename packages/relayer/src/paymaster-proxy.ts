export const ALLOWED_PAYMASTER_METHODS: ReadonlySet<string> = new Set([
  "paymaster_isAvailable",
  "paymaster_getSupportedTokens",
  "paymaster_buildTransaction",
  "paymaster_executeTransaction",
]);

export interface AvnuPaymasterProxyOptions {
  readonly apiKey: string;
  readonly endpoint?: string;
}

export interface PaymasterProxyResponse {
  readonly status: number;
  readonly body: unknown;
}

/**
 * Keeps the AVNU credential server-side. Request/response bodies contain proofs
 * and signatures and must never be logged. This follows StarkWare's privacy-
 * bridge proxy boundary and refuses JSON-RPC batches or unrelated methods.
 */
export async function forwardAvnuPaymasterRequest(
  body: unknown,
  options: AvnuPaymasterProxyOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<PaymasterProxyResponse> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(null, -32600, "single JSON-RPC request required", 400);
  }
  const request = body as Record<string, unknown>;
  const id =
    typeof request.id === "string" || typeof request.id === "number"
      ? request.id
      : null;
  if (
    typeof request.method !== "string" ||
    !ALLOWED_PAYMASTER_METHODS.has(request.method)
  ) {
    return rpcError(
      id,
      -32601,
      "method not allowed by the paymaster proxy",
      403,
    );
  }
  const endpoint = httpsUrl(
    options.endpoint ?? "https://starknet.paymaster.avnu.fi",
  );
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-paymaster-api-key": options.apiKey,
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
    return rpcError(id, -32603, "paymaster returned invalid JSON", 502);
  }
  return { status: response.status, body: responseBody };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  status: number,
): PaymasterProxyResponse {
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
    throw new Error("AVNU paymaster endpoint must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("AVNU paymaster endpoint must use credential-free HTTPS");
  }
  return parsed.href;
}
