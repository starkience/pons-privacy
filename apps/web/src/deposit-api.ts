import { LayerswapQuoteClient, type LayerswapQuote } from "@pons-privacy/sdk";

export interface DepositQuoteApi {
  quote(amountIn: bigint): Promise<LayerswapQuote>;
}

export function createDepositQuoteApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): DepositQuoteApi {
  const client = new LayerswapQuoteClient({ baseUrl, fetch: fetchImpl });
  return {
    quote: (amountIn) => client.quote("return-to-strk20", amountIn),
  };
}

export function parseUsdAmount(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{0,6})?$/.test(normalized)) {
    throw new Error("Enter a USDG amount with up to 6 decimals");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount <= 0n) throw new Error("Deposit amount must be positive");
  return amount;
}

export function formatUsdAmount(amount: bigint, maximumDecimals = 2): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .slice(0, maximumDecimals)
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
