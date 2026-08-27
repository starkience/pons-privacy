import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import type {
  StableTransportQuote,
  TransportAsset,
  TransportDirection,
  TransportNetwork,
} from "./transport.js";

export const LAYERSWAP_API_URL = "https://api.layerswap.io/api/v2";
export const LAYERSWAP_QUOTE_TTL_MS = 30_000;
export const LAYERSWAP_ROBINHOOD_USDG_ADDRESS =
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as Address;
export const LAYERSWAP_STARKNET_USDC_ADDRESS =
  "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

interface LayerswapRoute {
  readonly sourceNetwork: TransportNetwork;
  readonly sourceAsset: TransportAsset;
  readonly destinationNetwork: TransportNetwork;
  readonly destinationAsset: TransportAsset;
}

const ROUTES: Record<TransportDirection, LayerswapRoute> = {
  "fund-robinhood": {
    sourceNetwork: "STARKNET_MAINNET",
    sourceAsset: "USDC",
    destinationNetwork: "ROBINHOOD_MAINNET",
    destinationAsset: "USDG",
  },
  "return-to-strk20": {
    sourceNetwork: "ROBINHOOD_MAINNET",
    sourceAsset: "USDG",
    destinationNetwork: "STARKNET_MAINNET",
    destinationAsset: "USDC",
  },
};

export interface LayerswapQuote extends StableTransportQuote {
  readonly provider: "layerswap";
  readonly averageCompletionSeconds: number;
  readonly path: readonly string[];
}

export interface LayerswapLimits {
  readonly direction: TransportDirection;
  readonly minAmount: bigint;
  readonly maxAmount: bigint;
}

export interface LayerswapQuoteClientOptions {
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly quoteTtlMs?: number;
}

export type LayerswapSwapStatus =
  | "user_transfer_pending"
  | "ls_transfer_pending"
  | "completed"
  | "failed"
  | "expired"
  | "pending_refund"
  | "refunded";

export type LayerswapTransactionType = "input" | "output" | "refuel" | "refund";

export type LayerswapTransactionStatus = "completed" | "initiated" | "pending";

export interface LayerswapTransaction {
  readonly type: LayerswapTransactionType;
  readonly status: LayerswapTransactionStatus;
  readonly transactionHash?: string;
  readonly from?: string;
  readonly to?: string;
  readonly amount: bigint;
}

export type LayerswapDepositActionType =
  "transfer" | "manual_transfer" | "sign";

export interface LayerswapDepositAction {
  readonly type: LayerswapDepositActionType;
  readonly order: number;
  readonly network: "ROBINHOOD_MAINNET";
  readonly token: "USDG";
  readonly tokenAddress: Address;
  readonly toAddress: Address;
  readonly amount: bigint;
  readonly callData?: `0x${string}`;
  readonly typedData?: Readonly<Record<string, unknown>>;
  readonly validAfter?: number;
  readonly validBefore?: number;
  readonly nonce?: string;
}

export interface LayerswapSwap {
  readonly id: string;
  readonly createdAt: string;
  readonly referenceId?: string;
  readonly status: LayerswapSwapStatus;
  readonly failReason?: string;
  readonly sourceAddress?: Address;
  readonly destinationAddress: string;
  readonly amountIn: bigint;
  readonly useDepositAddress: boolean;
  readonly transactions: readonly LayerswapTransaction[];
}

export interface LayerswapPreparedSwap {
  readonly quote: LayerswapQuote;
  readonly swap: LayerswapSwap;
  readonly depositActions: readonly LayerswapDepositAction[];
}

export interface LayerswapStarknetCall {
  readonly contractAddress: string;
  readonly entrypoint: "transfer";
  readonly calldata: readonly [string, string, string];
}

export interface LayerswapFundingAction {
  readonly type: "transfer" | "manual_transfer";
  readonly order: number;
  readonly network: "STARKNET_MAINNET";
  readonly token: "USDC";
  readonly tokenAddress: string;
  readonly amount: bigint;
  readonly recipient: string;
  readonly call: LayerswapStarknetCall;
}

export interface LayerswapFundingSwap {
  readonly id: string;
  readonly createdAt: string;
  readonly referenceId?: string;
  readonly status: LayerswapSwapStatus;
  readonly failReason?: string;
  readonly sourceAddress: string;
  readonly destinationAddress: Address;
  readonly amountIn: bigint;
  readonly useDepositAddress: false;
  readonly transactions: readonly LayerswapTransaction[];
}

export interface LayerswapPreparedFundingSwap {
  readonly quote: LayerswapQuote;
  readonly swap: LayerswapFundingSwap;
  readonly depositAction: LayerswapFundingAction;
}

export interface CreateLayerswapReturnSwap {
  readonly amountIn: bigint;
  readonly sourceAddress: Address;
  readonly destinationAddress: string;
  readonly refundAddress: Address;
  readonly referenceId: string;
  /** Gasless signing remains disabled until its returned typed data is route-tested. */
  readonly useGasless?: false;
}

export interface CreateLayerswapFundingSwap {
  readonly amountIn: bigint;
  /** Fresh per-operation Starknet account. Never the root-linked STRK20 account. */
  readonly sourceAddress: string;
  /** Fresh Robinhood execution account controlled by the same root signature. */
  readonly destinationAddress: Address;
  readonly referenceId: string;
}

export class LayerswapQuoteClient {
  protected readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly now: () => number;
  protected readonly quoteTtlMs: number;
  protected readonly apiKey: string | undefined;

  constructor(options: LayerswapQuoteClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? LAYERSWAP_API_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.quoteTtlMs = options.quoteTtlMs ?? LAYERSWAP_QUOTE_TTL_MS;
    this.apiKey = options.apiKey;
    if (!Number.isSafeInteger(this.quoteTtlMs) || this.quoteTtlMs <= 0) {
      throw new Error("LayerSwap quote TTL must be a positive integer");
    }
  }

  async quote(
    direction: TransportDirection,
    amountIn: bigint,
  ): Promise<LayerswapQuote> {
    if (amountIn <= 0n) {
      throw new Error("LayerSwap quote amount must be positive");
    }
    const route = ROUTES[direction];
    const query = new URLSearchParams({
      source_network: route.sourceNetwork,
      source_token: route.sourceAsset,
      destination_network: route.destinationNetwork,
      destination_token: route.destinationAsset,
      amount: formatUnits(amountIn, 6),
    });
    const headers = new Headers({ accept: "application/json" });
    if (this.apiKey) headers.set("X-LS-APIKEY", this.apiKey);
    const payload = await this.request(`/quote?${query}`, {
      method: "GET",
      headers,
    });
    return parseQuote(
      record(record(payload.data, "data").quote, "data.quote"),
      direction,
      amountIn,
      this.now(),
      this.quoteTtlMs,
    );
  }

  async limits(direction: TransportDirection): Promise<LayerswapLimits> {
    const route = ROUTES[direction];
    const query = new URLSearchParams({
      source_network: route.sourceNetwork,
      source_token: route.sourceAsset,
      destination_network: route.destinationNetwork,
      destination_token: route.destinationAsset,
      use_deposit_address: "false",
      use_gasless: "false",
      refuel: "false",
      force_user_execution: "false",
    });
    const headers = new Headers({ accept: "application/json" });
    if (this.apiKey) headers.set("X-LS-APIKEY", this.apiKey);
    const payload = await this.request(`/limits?${query}`, {
      method: "GET",
      headers,
    });
    const data = record(payload.data, "data");
    const minAmount = units(data.min_amount, "min_amount");
    const maxAmount = units(data.max_amount, "max_amount");
    if (minAmount <= 0n || maxAmount < minAmount) {
      throw new Error("LayerSwap returned invalid route limits");
    }
    return { direction, minAmount, maxAmount };
  }

  protected async request(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const payload = await readPayload(response);
    if (
      !response.ok ||
      (payload.error !== undefined && payload.error !== null)
    ) {
      throw new Error(
        errorMessage(payload.error) ??
          `LayerSwap request failed with HTTP ${response.status}`,
      );
    }
    return payload;
  }
}

export class LayerswapClient extends LayerswapQuoteClient {
  async createFundingSwap(
    request: CreateLayerswapFundingSwap,
  ): Promise<LayerswapPreparedFundingSwap> {
    this.requireApiKey();
    if (request.amountIn <= 0n) {
      throw new Error("LayerSwap swap amount must be positive");
    }
    const sourceAddress = starknetAddress(
      request.sourceAddress,
      "sourceAddress",
    );
    const destinationAddress = evmAddress(
      request.destinationAddress,
      "destinationAddress",
    );
    const referenceId = reference(request.referenceId);
    const headers = this.authenticatedHeaders();
    headers.set("content-type", "application/json");
    headers.set("X-LS-CORRELATION-ID", referenceId);
    const payload = await this.request("/swaps", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_network: "STARKNET_MAINNET",
        source_token: "USDC",
        destination_network: "ROBINHOOD_MAINNET",
        destination_token: "USDG",
        amount: formatUnits(request.amountIn, 6),
        source_address: sourceAddress,
        destination_address: destinationAddress,
        refund_address: sourceAddress,
        reference_id: referenceId,
        refuel: false,
        use_deposit_address: false,
        use_depository: false,
        use_gasless: false,
        force_user_execution: false,
      }),
    });
    const data = record(payload.data, "data");
    const swap = parseFundingSwap(record(data.swap, "data.swap"));
    assertFundingSwap(swap, {
      amountIn: request.amountIn,
      sourceAddress,
      destinationAddress,
      referenceId,
    });
    const depositAction = parseFundingAction(
      data.deposit_actions,
      request.amountIn,
    );
    return {
      quote: parseQuote(
        record(data.quote, "data.quote"),
        "fund-robinhood",
        request.amountIn,
        this.now(),
        this.quoteTtlMs,
      ),
      swap,
      depositAction,
    };
  }

  async createReturnSwap(
    request: CreateLayerswapReturnSwap,
  ): Promise<LayerswapPreparedSwap> {
    this.requireApiKey();
    if (request.amountIn <= 0n) {
      throw new Error("LayerSwap swap amount must be positive");
    }
    const sourceAddress = evmAddress(request.sourceAddress, "sourceAddress");
    const refundAddress = evmAddress(request.refundAddress, "refundAddress");
    if (sourceAddress.toLowerCase() !== refundAddress.toLowerCase()) {
      throw new Error("LayerSwap refund address must equal the source address");
    }
    const destinationAddress = starknetAddress(
      request.destinationAddress,
      "destinationAddress",
    );
    const referenceId = reference(request.referenceId);
    const headers = this.authenticatedHeaders();
    headers.set("content-type", "application/json");
    headers.set("X-LS-CORRELATION-ID", referenceId);
    const payload = await this.request("/swaps", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source_network: "ROBINHOOD_MAINNET",
        source_token: "USDG",
        destination_network: "STARKNET_MAINNET",
        destination_token: "USDC",
        amount: formatUnits(request.amountIn, 6),
        source_address: sourceAddress,
        destination_address: destinationAddress,
        refund_address: refundAddress,
        reference_id: referenceId,
        refuel: false,
        use_deposit_address: false,
        use_depository: false,
        use_gasless: false,
        force_user_execution: false,
      }),
    });
    const data = record(payload.data, "data");
    const swap = parseSwap(record(data.swap, "data.swap"));
    assertReturnSwap(swap, {
      amountIn: request.amountIn,
      sourceAddress,
      destinationAddress,
      referenceId,
    });
    return {
      quote: parseQuote(
        record(data.quote, "data.quote"),
        "return-to-strk20",
        request.amountIn,
        this.now(),
        this.quoteTtlMs,
      ),
      swap,
      depositActions: parseDepositActions(
        data.deposit_actions ?? [],
        request.amountIn,
      ),
    };
  }

  async getSwap(swapId: string): Promise<LayerswapSwap> {
    const id = swapIdentifier(swapId);
    const payload = await this.request(`/swaps/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: this.authenticatedHeaders(),
    });
    return parseSwap(record(record(payload.data, "data").swap, "data.swap"));
  }

  async getFundingSwap(swapId: string): Promise<LayerswapFundingSwap> {
    const id = swapIdentifier(swapId);
    const payload = await this.request(`/swaps/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: this.authenticatedHeaders(),
    });
    return parseFundingSwap(
      record(record(payload.data, "data").swap, "data.swap"),
    );
  }

  async getDepositActions(
    swapId: string,
    sourceAddress: Address,
    expectedAmount: bigint,
  ): Promise<readonly LayerswapDepositAction[]> {
    const id = swapIdentifier(swapId);
    const source = evmAddress(sourceAddress, "sourceAddress");
    if (expectedAmount <= 0n) {
      throw new Error("LayerSwap expected amount must be positive");
    }
    const query = new URLSearchParams({ source_address: source });
    const payload = await this.request(
      `/swaps/${encodeURIComponent(id)}/deposit_actions?${query}`,
      { method: "GET", headers: this.authenticatedHeaders() },
    );
    const actionData = Array.isArray(payload.data)
      ? payload.data
      : record(payload.data, "data").value;
    return parseDepositActions(actionData, expectedAmount);
  }

  private authenticatedHeaders(): Headers {
    const headers = new Headers({ accept: "application/json" });
    headers.set("X-LS-APIKEY", this.requireApiKey());
    return headers;
  }

  private requireApiKey(): string {
    if (!this.apiKey) throw new Error("LayerSwap API key is required");
    return this.apiKey;
  }
}

function parseQuote(
  quote: Record<string, unknown>,
  direction: TransportDirection,
  amountIn: bigint,
  quotedAt: number,
  quoteTtlMs: number,
): LayerswapQuote {
  const route = ROUTES[direction];
  assertNamed(
    record(quote.source_network, "source_network"),
    route.sourceNetwork,
  );
  assertNamed(record(quote.source_token, "source_token"), route.sourceAsset);
  assertNamed(
    record(quote.destination_network, "destination_network"),
    route.destinationNetwork,
  );
  assertNamed(
    record(quote.destination_token, "destination_token"),
    route.destinationAsset,
  );

  const requestedAmount = units(quote.requested_amount, "requested_amount");
  if (requestedAmount !== amountIn) {
    throw new Error("LayerSwap quote changed the requested amount");
  }
  const expectedAmountOut = units(quote.receive_amount, "receive_amount");
  const minAmountOut = units(quote.min_receive_amount, "min_receive_amount");
  const feeAmount = units(quote.total_fee, "total_fee");
  if (minAmountOut <= 0n || expectedAmountOut < minAmountOut) {
    throw new Error("LayerSwap quote returned invalid output bounds");
  }
  return {
    provider: "layerswap",
    direction,
    ...route,
    amountIn,
    expectedAmountOut,
    minAmountOut,
    feeAmount,
    expiresAt: quotedAt + quoteTtlMs,
    averageCompletionSeconds: durationSeconds(
      quote.avg_completion_time,
      "avg_completion_time",
    ),
    path: path(recordArray(quote.path, "path")),
  };
}

function parseSwap(value: Record<string, unknown>): LayerswapSwap {
  assertNamed(
    record(value.source_network, "source_network"),
    "ROBINHOOD_MAINNET",
  );
  assertToken(
    record(value.source_token, "source_token"),
    "USDG",
    LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  );
  assertNamed(
    record(value.destination_network, "destination_network"),
    "STARKNET_MAINNET",
  );
  assertToken(
    record(value.destination_token, "destination_token"),
    "USDC",
    LAYERSWAP_STARKNET_USDC_ADDRESS,
  );
  const metadata = record(value.metadata, "metadata");
  const sourceAddress = nullableString(value.source_address, "source_address");
  const destinationAddress = starknetAddress(
    string(value.destination_address, "destination_address"),
    "destination_address",
  );
  const status = enumValue(
    value.status,
    "status",
    SWAP_STATUSES,
  ) as LayerswapSwapStatus;
  const failReason = nullableString(value.fail_reason, "fail_reason");
  const referenceId = nullableString(
    metadata.reference_id,
    "metadata.reference_id",
  );
  const createdAt = string(value.created_date, "created_date");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("created_date must be an ISO date");
  }
  if (typeof value.use_deposit_address !== "boolean") {
    throw new Error("use_deposit_address must be a boolean");
  }
  return {
    id: swapIdentifier(string(value.id, "id")),
    createdAt,
    ...(referenceId ? { referenceId } : {}),
    status,
    ...(failReason ? { failReason } : {}),
    ...(sourceAddress
      ? { sourceAddress: evmAddress(sourceAddress, "source_address") }
      : {}),
    destinationAddress,
    amountIn: units(value.requested_amount, "requested_amount"),
    useDepositAddress: value.use_deposit_address,
    transactions: parseTransactions(value.transactions),
  };
}

function parseFundingSwap(
  value: Record<string, unknown>,
): LayerswapFundingSwap {
  assertNamed(
    record(value.source_network, "source_network"),
    "STARKNET_MAINNET",
  );
  assertToken(
    record(value.source_token, "source_token"),
    "USDC",
    LAYERSWAP_STARKNET_USDC_ADDRESS,
  );
  assertNamed(
    record(value.destination_network, "destination_network"),
    "ROBINHOOD_MAINNET",
  );
  assertToken(
    record(value.destination_token, "destination_token"),
    "USDG",
    LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  );
  const metadata = record(value.metadata, "metadata");
  const sourceAddress = starknetAddress(
    string(value.source_address, "source_address"),
    "source_address",
  );
  const destinationAddress = evmAddress(
    string(value.destination_address, "destination_address"),
    "destination_address",
  );
  const status = enumValue(
    value.status,
    "status",
    SWAP_STATUSES,
  ) as LayerswapSwapStatus;
  const failReason = nullableString(value.fail_reason, "fail_reason");
  const referenceId = nullableString(
    metadata.reference_id,
    "metadata.reference_id",
  );
  const createdAt = string(value.created_date, "created_date");
  if (Number.isNaN(Date.parse(createdAt))) {
    throw new Error("created_date must be an ISO date");
  }
  if (value.use_deposit_address !== false) {
    throw new Error("funding swap must not use a managed deposit address");
  }
  return {
    id: swapIdentifier(string(value.id, "id")),
    createdAt,
    ...(referenceId ? { referenceId } : {}),
    status,
    ...(failReason ? { failReason } : {}),
    sourceAddress,
    destinationAddress,
    amountIn: units(value.requested_amount, "requested_amount"),
    useDepositAddress: false,
    transactions: parseTransactions(value.transactions),
  };
}

function parseTransactions(value: unknown): LayerswapTransaction[] {
  return recordArray(value, "transactions").map((entry, index) => {
    const type = enumValue(
      entry.type,
      `transactions[${index}].type`,
      TRANSACTION_TYPES,
    ) as LayerswapTransactionType;
    const status = enumValue(
      entry.status,
      `transactions[${index}].status`,
      TRANSACTION_STATUSES,
    ) as LayerswapTransactionStatus;
    const transactionHash = nullableString(
      entry.transaction_hash,
      `transactions[${index}].transaction_hash`,
    );
    const from = nullableString(entry.from, `transactions[${index}].from`);
    const to = nullableString(entry.to, `transactions[${index}].to`);
    return {
      type,
      status,
      ...(transactionHash ? { transactionHash } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      amount: units(entry.amount, `transactions[${index}].amount`),
    };
  });
}

function parseDepositActions(
  value: unknown,
  expectedAmount: bigint,
): LayerswapDepositAction[] {
  if (!Array.isArray(value))
    throw new Error("deposit_actions must be an array");
  const actions = value.map((item, index) => {
    const action = record(item, `deposit_actions[${index}]`);
    const type = enumValue(
      action.type,
      `deposit_actions[${index}].type`,
      DEPOSIT_ACTION_TYPES,
    ) as LayerswapDepositActionType;
    const network = record(action.network, `deposit_actions[${index}].network`);
    assertNamed(network, "ROBINHOOD_MAINNET");
    const token = record(action.token, `deposit_actions[${index}].token`);
    assertToken(token, "USDG", LAYERSWAP_ROBINHOOD_USDG_ADDRESS);
    const amount = baseUnits(
      action.amount_in_base_units,
      `deposit_actions[${index}].amount_in_base_units`,
    );
    if (amount !== expectedAmount) {
      throw new Error(`deposit_actions[${index}] changed the deposit amount`);
    }
    const order = integer(action.order, `deposit_actions[${index}].order`);
    const toAddress = evmAddress(
      string(action.to_address, `deposit_actions[${index}].to_address`),
      `deposit_actions[${index}].to_address`,
    );
    const callDataValue = nullableString(
      action.call_data,
      `deposit_actions[${index}].call_data`,
    );
    const callData = callDataValue
      ? hex(callDataValue, `deposit_actions[${index}].call_data`)
      : undefined;
    const typedData =
      action.typed_data === undefined || action.typed_data === null
        ? undefined
        : record(action.typed_data, `deposit_actions[${index}].typed_data`);
    if (type === "sign" && !typedData) {
      throw new Error(`deposit_actions[${index}].typed_data is required`);
    }
    const validAfter = optionalInteger(
      action.valid_after,
      `deposit_actions[${index}].valid_after`,
    );
    const validBefore = optionalInteger(
      action.valid_before,
      `deposit_actions[${index}].valid_before`,
    );
    const nonce = nullableString(
      action.nonce,
      `deposit_actions[${index}].nonce`,
    );
    return {
      type,
      order,
      network: "ROBINHOOD_MAINNET" as const,
      token: "USDG" as const,
      tokenAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
      toAddress,
      amount,
      ...(callData ? { callData } : {}),
      ...(typedData ? { typedData } : {}),
      ...(validAfter !== undefined ? { validAfter } : {}),
      ...(validBefore !== undefined ? { validBefore } : {}),
      ...(nonce ? { nonce } : {}),
    };
  });
  const orders = new Set(actions.map((action) => action.order));
  if (orders.size !== actions.length) {
    throw new Error("deposit_actions contains duplicate order values");
  }
  return actions.sort((left, right) => left.order - right.order);
}

export function parseLayerswapFundingAction(
  value: unknown,
  expectedAmount: bigint,
): LayerswapFundingAction {
  return parseFundingAction(value, expectedAmount);
}

function parseFundingAction(
  value: unknown,
  expectedAmount: bigint,
): LayerswapFundingAction {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("funding deposit_actions must contain exactly one action");
  }
  const action = record(value[0], "deposit_actions[0]");
  const type = enumValue(action.type, "deposit_actions[0].type", [
    "transfer",
    "manual_transfer",
  ]) as "transfer" | "manual_transfer";
  assertNamed(
    record(action.network, "deposit_actions[0].network"),
    "STARKNET_MAINNET",
  );
  assertToken(
    record(action.token, "deposit_actions[0].token"),
    "USDC",
    LAYERSWAP_STARKNET_USDC_ADDRESS,
  );
  const amount = baseUnits(
    action.amount_in_base_units,
    "deposit_actions[0].amount_in_base_units",
  );
  if (amount !== expectedAmount) {
    throw new Error("funding deposit action changed the deposit amount");
  }
  const order = integer(action.order, "deposit_actions[0].order");
  if (order !== 0) {
    throw new Error("funding deposit action order must be zero");
  }
  const callData = nullableString(
    action.call_data,
    "deposit_actions[0].call_data",
  );
  const call = callData
    ? parseStarknetTransferCall(callData, amount)
    : manualStarknetTransferCall(action.to_address, amount);
  if (
    action.to_address !== undefined &&
    action.to_address !== null &&
    BigInt(
      starknetAddress(
        string(action.to_address, "deposit_actions[0].to_address"),
        "deposit_actions[0].to_address",
      ),
    ) !== BigInt(call.calldata[0])
  ) {
    throw new Error(
      "funding action to_address does not match transfer recipient",
    );
  }
  return {
    type,
    order,
    network: "STARKNET_MAINNET",
    token: "USDC",
    tokenAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    amount,
    recipient: call.calldata[0],
    call,
  };
}

function parseStarknetTransferCall(
  raw: string,
  expectedAmount: bigint,
): LayerswapStarknetCall {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("funding call_data must be a Starknet call JSON array");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("funding call_data must contain exactly one Starknet call");
  }
  const value = record(parsed[0], "funding call_data[0]");
  const contractAddress = starknetAddress(
    string(
      value.contractAddress ?? value.contract_address,
      "funding call_data[0].contractAddress",
    ),
    "funding call_data[0].contractAddress",
  );
  if (BigInt(contractAddress) !== BigInt(LAYERSWAP_STARKNET_USDC_ADDRESS)) {
    throw new Error("funding call_data may call only Starknet USDC");
  }
  if (value.entrypoint !== "transfer") {
    throw new Error("funding call_data may call only USDC transfer");
  }
  if (!Array.isArray(value.calldata) || value.calldata.length !== 3) {
    throw new Error(
      "funding USDC transfer calldata must contain recipient and u256 amount",
    );
  }
  const recipient = starknetAddress(
    feltString(value.calldata[0], "funding transfer recipient"),
    "funding transfer recipient",
  );
  const low = feltBigInt(value.calldata[1], "funding transfer amount low");
  const high = feltBigInt(value.calldata[2], "funding transfer amount high");
  if (low >= 1n << 128n || high >= 1n << 128n) {
    throw new Error("funding transfer amount is not a Cairo u256");
  }
  if (low + (high << 128n) !== expectedAmount) {
    throw new Error("funding call_data changed the deposit amount");
  }
  return {
    contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    entrypoint: "transfer",
    calldata: [recipient, low.toString(), high.toString()],
  };
}

function manualStarknetTransferCall(
  toAddress: unknown,
  amount: bigint,
): LayerswapStarknetCall {
  const recipient = starknetAddress(
    string(toAddress, "deposit_actions[0].to_address"),
    "deposit_actions[0].to_address",
  );
  return {
    contractAddress: LAYERSWAP_STARKNET_USDC_ADDRESS,
    entrypoint: "transfer",
    calldata: [
      recipient,
      (amount & ((1n << 128n) - 1n)).toString(),
      (amount >> 128n).toString(),
    ],
  };
}

function assertReturnSwap(
  swap: LayerswapSwap,
  expected: {
    amountIn: bigint;
    sourceAddress: Address;
    destinationAddress: string;
    referenceId: string;
  },
): void {
  if (swap.amountIn !== expected.amountIn) {
    throw new Error("LayerSwap created swap changed the requested amount");
  }
  if (
    !swap.sourceAddress ||
    swap.sourceAddress.toLowerCase() !== expected.sourceAddress.toLowerCase()
  ) {
    throw new Error("LayerSwap created swap changed the source address");
  }
  if (BigInt(swap.destinationAddress) !== BigInt(expected.destinationAddress)) {
    throw new Error("LayerSwap created swap changed the destination address");
  }
  if (swap.referenceId !== expected.referenceId) {
    throw new Error("LayerSwap created swap changed the reference ID");
  }
  if (swap.useDepositAddress) {
    throw new Error("LayerSwap unexpectedly enabled a managed deposit address");
  }
}

function assertFundingSwap(
  swap: LayerswapFundingSwap,
  expected: {
    amountIn: bigint;
    sourceAddress: string;
    destinationAddress: Address;
    referenceId: string;
  },
): void {
  if (swap.amountIn !== expected.amountIn) {
    throw new Error("LayerSwap created swap changed the requested amount");
  }
  if (BigInt(swap.sourceAddress) !== BigInt(expected.sourceAddress)) {
    throw new Error("LayerSwap created swap changed the source address");
  }
  if (
    swap.destinationAddress.toLowerCase() !==
    expected.destinationAddress.toLowerCase()
  ) {
    throw new Error("LayerSwap created swap changed the destination address");
  }
  if (swap.referenceId !== expected.referenceId) {
    throw new Error("LayerSwap created swap changed the reference ID");
  }
}

const SWAP_STATUSES = [
  "user_transfer_pending",
  "ls_transfer_pending",
  "completed",
  "failed",
  "expired",
  "pending_refund",
  "refunded",
] as const;
const TRANSACTION_TYPES = ["input", "output", "refuel", "refund"] as const;
const TRANSACTION_STATUSES = ["completed", "initiated", "pending"] as const;
const DEPOSIT_ACTION_TYPES = ["transfer", "manual_transfer", "sign"] as const;

function normalizeBaseUrl(value: string): string {
  const base = value.replace(/\/$/, "");
  if (!base) throw new Error("LayerSwap API URL is required");
  if (base.startsWith("/") || base.startsWith("https://")) return base;
  throw new Error("LayerSwap API URL must be relative or use HTTPS");
}

async function readPayload(
  response: Response,
): Promise<Record<string, unknown>> {
  try {
    return record(await response.json(), "LayerSwap response");
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes("must be an object")) {
      throw cause;
    }
    throw new Error("LayerSwap returned invalid JSON");
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((entry, index) => record(entry, `${field}[${index}]`));
}

function assertNamed(value: Record<string, unknown>, expected: string): void {
  if (value.name !== expected && value.symbol !== expected) {
    throw new Error(`LayerSwap quote route mismatch: expected ${expected}`);
  }
}

function assertToken(
  value: Record<string, unknown>,
  expectedSymbol: string,
  expectedContract: string,
): void {
  assertNamed(value, expectedSymbol);
  const contract = string(value.contract, `${expectedSymbol}.contract`);
  if (BigInt(contract) !== BigInt(expectedContract)) {
    throw new Error(
      `LayerSwap token contract mismatch: expected ${expectedContract}`,
    );
  }
  if (value.decimals !== 6) {
    throw new Error(`LayerSwap ${expectedSymbol} must use 6 decimals`);
  }
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function feltString(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${field} must be a felt`);
  }
  const result = String(value);
  if (!/^(?:0x[0-9a-fA-F]+|0|[1-9][0-9]*)$/.test(result)) {
    throw new Error(`${field} must be a felt`);
  }
  return result.startsWith("0x") ? result : `0x${BigInt(result).toString(16)}`;
}

function feltBigInt(value: unknown, field: string): bigint {
  const raw = feltString(value, field);
  const parsed = BigInt(raw);
  if (parsed < 0n || parsed >= 2n ** 251n) {
    throw new Error(`${field} is outside the felt range`);
  }
  return parsed;
}

function nullableString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return;
  return string(value, field);
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return Number(value);
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return;
  return integer(value, field);
}

function enumValue(
  value: unknown,
  field: string,
  allowed: readonly string[],
): string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${field} is not supported`);
  }
  return value;
}

function baseUnits(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be a base-unit integer string`);
  }
  return BigInt(value);
}

function evmAddress(value: string, field: string): Address {
  if (!isAddress(value) || BigInt(value) === 0n) {
    throw new Error(`${field} must be a non-zero EVM address`);
  }
  return value as Address;
}

function starknetAddress(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`${field} must be a Starknet hex address`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= 2n ** 251n) {
    throw new Error(`${field} must be a non-zero Starknet address`);
  }
  return value.toLowerCase();
}

function reference(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("LayerSwap reference ID must be a UUID");
  }
  return value;
}

function swapIdentifier(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error("LayerSwap swap ID must be a UUID");
  }
  return value;
}

function hex(value: string, field: string): `0x${string}` {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${field} must be even-length hex calldata`);
  }
  return value as `0x${string}`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function units(value: unknown, field: string): bigint {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`${field} must be numeric`);
  }
  const decimal = String(value);
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(decimal)) {
    throw new Error(
      `${field} must be a non-negative decimal with at most six places`,
    );
  }
  try {
    return parseUnits(decimal, 6);
  } catch {
    throw new Error(`${field} exceeds six decimal places`);
  }
}

function durationSeconds(value: unknown, field: string): number {
  if (typeof value !== "string") throw new Error(`${field} must be a duration`);
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`${field} must use HH:MM:SS format`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) {
    throw new Error(`${field} contains an invalid time`);
  }
  const fraction = match[4] ? Number(`0.${match[4]}`) : 0;
  return hours * 3_600 + minutes * 60 + seconds + fraction;
}

function path(entries: Record<string, unknown>[]): string[] {
  return entries.map((entry, index) => {
    if (typeof entry.provider !== "string" || !entry.provider) {
      throw new Error(`path[${index}].provider must be a string`);
    }
    return entry.provider;
  });
}

function errorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message ? message : undefined;
}
