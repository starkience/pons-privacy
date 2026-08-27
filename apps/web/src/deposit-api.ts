import {
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  LAYERSWAP_STARKNET_USDC_ADDRESS,
  type LayerswapDepositAction,
  type LayerswapFundingAction,
  type LayerswapQuote,
  type LayerswapSwapStatus,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";
import { relayExecutionRequestJson } from "@pons-privacy/sdk";
import { isAddress, type Address } from "viem";

export interface PrivacySwapStatus {
  readonly id: string;
  readonly status: LayerswapSwapStatus;
  readonly amountIn: bigint;
  readonly sourceAddress: string;
  readonly destinationAddress: string;
  readonly inputTransactionHash?: string;
  readonly outputTransactionHash?: string;
  /** Actual destination-chain base units from LayerSwap's output transaction. */
  readonly outputAmount?: bigint;
  readonly failReason?: string;
}

export interface PreparedDepositSwap {
  readonly quote: LayerswapQuote;
  readonly swap: PrivacySwapStatus;
  readonly depositActions: readonly LayerswapDepositAction[];
}

export interface PreparedFundingSwap {
  readonly quote: LayerswapQuote;
  readonly swap: PrivacySwapStatus;
  readonly depositAction: LayerswapFundingAction;
}

export interface DepositQuoteApi {
  quote(amountIn: bigint): Promise<LayerswapQuote>;
  quoteFunding?(amountIn: bigint): Promise<LayerswapQuote>;
  createDepositSwap?(request: {
    operationId: string;
    amountIn: bigint;
    sourceAddress: string;
    destinationAddress: string;
  }): Promise<PreparedDepositSwap>;
  createFundingSwap?(request: {
    operationId: string;
    amountIn: bigint;
    sourceAddress: string;
    destinationAddress: string;
  }): Promise<PreparedFundingSwap>;
  getDepositSwap?(
    swapId: string,
    sourceAddress: string,
  ): Promise<PrivacySwapStatus>;
  getFundingSwap?(
    swapId: string,
    sourceAddress: string,
  ): Promise<PrivacySwapStatus>;
  getDepositActions?(
    swapId: string,
    sourceAddress: string,
    amountIn: bigint,
  ): Promise<readonly LayerswapDepositAction[]>;
  getFundingAction?(
    swapId: string,
    sourceAddress: string,
    amountIn: bigint,
  ): Promise<LayerswapFundingAction>;
  submitReturnRequest?(
    swapId: string,
    sourceAddress: string,
    request: RelayExecutionRequest,
  ): Promise<string>;
}

export function createDepositQuoteApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): DepositQuoteApi {
  const base = normalizeBaseUrl(baseUrl);

  async function get(path: string): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    return responsePayload(response);
  }

  async function post(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return responsePayload(response);
  }

  return {
    async quote(amountIn) {
      return quote(get, "deposits", "return-to-strk20", amountIn);
    },
    async quoteFunding(amountIn) {
      return quote(get, "funding", "fund-robinhood", amountIn);
    },
    async createDepositSwap(request) {
      assertPositive(request.amountIn, "Deposit amount");
      const sourceAddress = evmAddress(request.sourceAddress, "sourceAddress");
      const destinationAddress = starknetAddress(
        request.destinationAddress,
        "destinationAddress",
      );
      const payload = await post("/deposits/swaps", {
        operationId: identifier(request.operationId),
        amount: request.amountIn.toString(),
        sourceAddress,
        destinationAddress,
      });
      const swap = parseSwap(record(payload.swap, "swap"), "deposit");
      assertSwapRoute(
        swap,
        request.amountIn,
        sourceAddress,
        destinationAddress,
      );
      return {
        quote: parseQuote(
          record(payload.quote, "quote"),
          request.amountIn,
          "return-to-strk20",
        ),
        swap,
        depositActions: parseDepositActions(
          payload.depositActions,
          request.amountIn,
        ),
      };
    },
    async createFundingSwap(request) {
      assertPositive(request.amountIn, "Funding amount");
      const sourceAddress = starknetAddress(
        request.sourceAddress,
        "sourceAddress",
      );
      const destinationAddress = evmAddress(
        request.destinationAddress,
        "destinationAddress",
      );
      const payload = await post("/funding/swaps", {
        operationId: identifier(request.operationId),
        amount: request.amountIn.toString(),
        sourceAddress,
        destinationAddress,
      });
      const swap = parseSwap(record(payload.swap, "swap"), "funding");
      assertSwapRoute(
        swap,
        request.amountIn,
        sourceAddress,
        destinationAddress,
      );
      return {
        quote: parseQuote(
          record(payload.quote, "quote"),
          request.amountIn,
          "fund-robinhood",
        ),
        swap,
        depositAction: parseFundingAction(
          payload.depositAction,
          request.amountIn,
        ),
      };
    },
    async getDepositSwap(swapId, sourceAddress) {
      const source = evmAddress(sourceAddress, "sourceAddress");
      return parseSwap(
        await get(
          `/deposits/swaps/${encodeURIComponent(identifier(swapId))}?${new URLSearchParams({ sourceAddress: source })}`,
        ),
        "deposit",
      );
    },
    async getFundingSwap(swapId, sourceAddress) {
      const source = starknetAddress(sourceAddress, "sourceAddress");
      return parseSwap(
        await get(
          `/funding/swaps/${encodeURIComponent(identifier(swapId))}?${new URLSearchParams({ sourceAddress: source })}`,
        ),
        "funding",
      );
    },
    async getDepositActions(swapId, sourceAddress, amountIn) {
      assertPositive(amountIn, "Deposit amount");
      const source = evmAddress(sourceAddress, "sourceAddress");
      const payload = await get(
        `/deposits/swaps/${encodeURIComponent(identifier(swapId))}/deposit-actions?${new URLSearchParams({ sourceAddress: source })}`,
      );
      const swap = parseSwap(record(payload.swap, "swap"), "deposit");
      if (
        swap.amountIn !== amountIn ||
        BigInt(swap.sourceAddress) !== BigInt(source)
      ) {
        throw new Error("recovered deposit action changed the pending swap");
      }
      return parseDepositActions(payload.actions, amountIn);
    },
    async getFundingAction(swapId, sourceAddress, amountIn) {
      assertPositive(amountIn, "Funding amount");
      const source = starknetAddress(sourceAddress, "sourceAddress");
      const payload = await get(
        `/funding/swaps/${encodeURIComponent(identifier(swapId))}/deposit-action?${new URLSearchParams({ sourceAddress: source })}`,
      );
      const swap = parseSwap(record(payload.swap, "swap"), "funding");
      if (
        swap.amountIn !== amountIn ||
        BigInt(swap.sourceAddress) !== BigInt(source)
      ) {
        throw new Error("recovered funding action changed the pending swap");
      }
      return parseFundingAction(payload.action, amountIn);
    },
    async submitReturnRequest(swapId, sourceAddress, request) {
      const source = evmAddress(sourceAddress, "sourceAddress");
      if (request.account.toLowerCase() !== source.toLowerCase()) {
        throw new Error("signed return request changed the R2 source account");
      }
      const payload = await post(
        `/deposits/swaps/${encodeURIComponent(identifier(swapId))}/relay`,
        {
          sourceAddress: source,
          relayRequest: relayExecutionRequestJson(request),
        },
      );
      return transactionHash(payload.transactionHash, "transactionHash");
    },
  };
}

async function quote(
  get: (path: string) => Promise<Record<string, unknown>>,
  endpoint: "deposits" | "funding",
  direction: "return-to-strk20" | "fund-robinhood",
  amountIn: bigint,
): Promise<LayerswapQuote> {
  assertPositive(amountIn, "Quote amount");
  return parseQuote(
    await get(
      `/${endpoint}/quote?${new URLSearchParams({ amount: amountIn.toString() })}`,
    ),
    amountIn,
    direction,
  );
}

function parseQuote(
  payload: Record<string, unknown>,
  requestedAmount: bigint,
  direction: "return-to-strk20" | "fund-robinhood",
): LayerswapQuote {
  const deposit = direction === "return-to-strk20";
  if (
    payload.provider !== "layerswap" ||
    payload.direction !== direction ||
    payload.sourceNetwork !==
      (deposit ? "ROBINHOOD_MAINNET" : "STARKNET_MAINNET") ||
    payload.sourceAsset !== (deposit ? "USDG" : "USDC") ||
    payload.destinationNetwork !==
      (deposit ? "STARKNET_MAINNET" : "ROBINHOOD_MAINNET") ||
    payload.destinationAsset !== (deposit ? "USDC" : "USDG")
  ) {
    throw new Error("Deposit API returned an unexpected route");
  }
  const amountIn = bigint(payload.amountIn, "amountIn");
  if (amountIn !== requestedAmount)
    throw new Error("Deposit API changed the requested amount");
  const expectedAmountOut = bigint(
    payload.expectedAmountOut,
    "expectedAmountOut",
  );
  const minAmountOut = bigint(payload.minAmountOut, "minAmountOut");
  const feeAmount = bigint(payload.feeAmount, "feeAmount");
  const expiresAt = safeNumber(payload.expiresAt, "expiresAt");
  const averageCompletionSeconds = finiteNumber(
    payload.averageCompletionSeconds,
    "averageCompletionSeconds",
  );
  if (!Array.isArray(payload.path) || !payload.path.every(isNonEmptyString)) {
    throw new Error("path must be a string array");
  }
  if (minAmountOut <= 0n || expectedAmountOut < minAmountOut) {
    throw new Error("Deposit API returned invalid output bounds");
  }
  return {
    provider: "layerswap",
    direction,
    sourceNetwork: deposit ? "ROBINHOOD_MAINNET" : "STARKNET_MAINNET",
    sourceAsset: deposit ? "USDG" : "USDC",
    destinationNetwork: deposit ? "STARKNET_MAINNET" : "ROBINHOOD_MAINNET",
    destinationAsset: deposit ? "USDC" : "USDG",
    amountIn,
    expectedAmountOut,
    minAmountOut,
    feeAmount,
    expiresAt,
    averageCompletionSeconds,
    path: payload.path,
  };
}

function parseSwap(
  value: Record<string, unknown>,
  direction: "deposit" | "funding",
): PrivacySwapStatus {
  const status = enumString(value.status, "status", [
    "user_transfer_pending",
    "ls_transfer_pending",
    "completed",
    "failed",
    "expired",
    "pending_refund",
    "refunded",
  ]) as LayerswapSwapStatus;
  const sourceAddress =
    direction === "deposit"
      ? evmAddress(value.sourceAddress, "sourceAddress")
      : starknetAddress(value.sourceAddress, "sourceAddress");
  const destinationAddress =
    direction === "deposit"
      ? starknetAddress(value.destinationAddress, "destinationAddress")
      : evmAddress(value.destinationAddress, "destinationAddress");
  const transactions = Array.isArray(value.transactions)
    ? value.transactions
    : [];
  const transactionHash = (type: "input" | "output") => {
    const transaction = transactions.find(
      (candidate) => record(candidate, "transaction").type === type,
    );
    if (!transaction) return undefined;
    const hash = record(transaction, "transaction").transactionHash;
    return typeof hash === "string" && hash ? hash : undefined;
  };
  const inputTransactionHash = transactionHash("input");
  const outputTransactionHash = transactionHash("output");
  const outputTransaction = transactions.find(
    (candidate) => record(candidate, "transaction").type === "output",
  );
  const outputAmount = outputTransaction
    ? bigint(
        record(outputTransaction, "output transaction").amount,
        "output transaction amount",
      )
    : undefined;
  const failReason =
    typeof value.failReason === "string" && value.failReason
      ? value.failReason
      : undefined;
  return {
    id: identifier(value.id),
    status,
    amountIn: bigint(value.amountIn, "amountIn"),
    sourceAddress,
    destinationAddress,
    ...(inputTransactionHash ? { inputTransactionHash } : {}),
    ...(outputTransactionHash ? { outputTransactionHash } : {}),
    ...(outputAmount !== undefined ? { outputAmount } : {}),
    ...(failReason ? { failReason } : {}),
  };
}

function parseDepositActions(
  value: unknown,
  amount: bigint,
): LayerswapDepositAction[] {
  if (!Array.isArray(value)) throw new Error("depositActions must be an array");
  return value
    .map((candidate, index) => {
      const action = record(candidate, `depositActions[${index}]`);
      const type = enumString(action.type, "action.type", [
        "transfer",
        "manual_transfer",
        "sign",
      ]) as LayerswapDepositAction["type"];
      if (
        action.network !== "ROBINHOOD_MAINNET" ||
        action.token !== "USDG" ||
        !sameAddress(action.tokenAddress, LAYERSWAP_ROBINHOOD_USDG_ADDRESS)
      ) {
        throw new Error(
          "deposit action changed the pinned Robinhood USDG route",
        );
      }
      const actionAmount = bigint(action.amount, "action.amount");
      if (actionAmount !== amount)
        throw new Error("deposit action changed the amount");
      const callData =
        action.callData === undefined
          ? undefined
          : hex(action.callData, "action.callData");
      return {
        type,
        order: safeNumber(action.order, "action.order"),
        network: "ROBINHOOD_MAINNET" as const,
        token: "USDG" as const,
        tokenAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
        toAddress: evmAddress(action.toAddress, "action.toAddress"),
        amount: actionAmount,
        ...(callData ? { callData } : {}),
        ...(action.typedData && typeof action.typedData === "object"
          ? { typedData: action.typedData as Readonly<Record<string, unknown>> }
          : {}),
      };
    })
    .sort((left, right) => left.order - right.order);
}

function parseFundingAction(
  value: unknown,
  amount: bigint,
): LayerswapFundingAction {
  const action = record(value, "depositAction");
  if (
    (action.type !== "transfer" && action.type !== "manual_transfer") ||
    action.network !== "STARKNET_MAINNET" ||
    action.token !== "USDC" ||
    BigInt(starknetAddress(action.tokenAddress, "action.tokenAddress")) !==
      BigInt(LAYERSWAP_STARKNET_USDC_ADDRESS)
  ) {
    throw new Error("funding action changed the pinned Starknet USDC route");
  }
  const actionAmount = bigint(action.amount, "action.amount");
  if (actionAmount !== amount)
    throw new Error("funding action changed the amount");
  const call = record(action.call, "action.call");
  if (
    call.entrypoint !== "transfer" ||
    !Array.isArray(call.calldata) ||
    call.calldata.length !== 3
  ) {
    throw new Error("funding action must be one Starknet USDC transfer");
  }
  const contractAddress = starknetAddress(
    call.contractAddress,
    "call.contractAddress",
  );
  const recipient = starknetAddress(action.recipient, "action.recipient");
  const calldata = call.calldata.map((item, index) =>
    felt(item, `call.calldata[${index}]`),
  );
  if (
    BigInt(contractAddress) !== BigInt(LAYERSWAP_STARKNET_USDC_ADDRESS) ||
    BigInt(calldata[0]!) !== BigInt(recipient) ||
    BigInt(calldata[1]!) + (BigInt(calldata[2]!) << 128n) !== amount
  ) {
    throw new Error("funding action recipient or amount changed");
  }
  return {
    type: action.type,
    order: safeNumber(action.order, "action.order"),
    network: "STARKNET_MAINNET",
    token: "USDC",
    tokenAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    amount,
    recipient,
    call: {
      contractAddress,
      entrypoint: "transfer",
      calldata: [calldata[0]!, calldata[1]!, calldata[2]!],
    },
  };
}

function assertSwapRoute(
  swap: PrivacySwapStatus,
  amount: bigint,
  source: string,
  destination: string,
): void {
  if (
    swap.amountIn !== amount ||
    BigInt(swap.sourceAddress) !== BigInt(source) ||
    BigInt(swap.destinationAddress) !== BigInt(destination)
  ) {
    throw new Error("created swap changed the requested route");
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (
    !normalized ||
    (!normalized.startsWith("/") && !normalized.startsWith("https://"))
  ) {
    throw new Error("Deposit API URL must be relative or use HTTPS");
  }
  return normalized;
}

async function responsePayload(
  response: Response,
): Promise<Record<string, unknown>> {
  const payload = await json(response);
  if (!response.ok)
    throw new Error(errorMessage(payload) ?? "Deposit API request failed");
  return payload;
}

async function json(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    return record(payload, "Deposit API response");
  } catch (error) {
    if (error instanceof Error && error.message.includes("must be an object"))
      throw error;
    throw new Error("Deposit API returned invalid JSON");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${field} must be an object`);
  return value as Record<string, unknown>;
}

function bigint(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a base-unit integer`);
  }
  return BigInt(value);
}

function safeNumber(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error(`${field} must be a non-negative safe integer`);
  return Number(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return value;
}

function evmAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value) || BigInt(value) === 0n) {
    throw new Error(`${field} must be a non-zero EVM address`);
  }
  return value;
}

function starknetAddress(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`${field} must be a Starknet address`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= 2n ** 251n)
    throw new Error(`${field} must be a Starknet address`);
  return `0x${parsed.toString(16)}`;
}

function felt(value: unknown, field: string): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`${field} must be a felt`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= 2n ** 251n)
    throw new Error(`${field} must be a felt`);
  return parsed.toString();
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  ) {
    throw new Error("invalid swap identifier");
  }
  return value;
}

function enumString(
  value: unknown,
  field: string,
  allowed: readonly string[],
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error(`${field} is unsupported`);
  return value;
}

function hex(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${field} must be hex calldata`);
  }
  return value as `0x${string}`;
}

function transactionHash(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a transaction hash`);
  }
  return value;
}

function sameAddress(value: unknown, expected: string): boolean {
  return (
    typeof value === "string" &&
    isAddress(value) &&
    value.toLowerCase() === expected.toLowerCase()
  );
}

function assertPositive(value: bigint, field: string): void {
  if (value <= 0n) throw new Error(`${field} must be positive`);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function errorMessage(payload: Record<string, unknown>): string | undefined {
  return typeof payload.error === "string" && payload.error
    ? payload.error
    : undefined;
}

export function parseUsdAmount(value: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{0,6})?$/.test(normalized)) {
    throw new Error("Enter a stablecoin amount with up to 6 decimals");
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
