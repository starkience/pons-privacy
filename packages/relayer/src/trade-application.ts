import { randomUUID } from "node:crypto";
import {
  decodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  stringToHex,
  verifyTypedData,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";
import {
  applySlippage,
  buyMinimumFromQuote,
  erc20Abi,
  executionTypedData,
  NO_RELAYER_FEE,
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PONS_V2_ROBINHOOD,
  ponsPrivacyAccountFactoryAbi,
  ponsV2CurveAbi,
  ponsV2FactoryAbi,
  quotePonsV2Buy,
  quotePonsV2Sell,
  relayExecutionRequestJson,
  RelayerRejectedError,
  ROBINHOOD_MAINNET_CHAIN_ID,
  type RelayExecution,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";
import { validatePonsV2Calls } from "./pons-v2-policy.js";
import type {
  StoredTradeSubmission,
  TradeApplicationStore,
} from "./trade-application-store.js";

const DEFAULT_PREVIEW_TTL_MS = 2 * 60_000;
const MAX_APPLICATION_SLIPPAGE_BPS = 1_000;

export interface TradeAccount {
  readonly account: Address;
  readonly owner: Address;
  readonly accountIndex: number;
}

export interface TradePreview {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly side: "buy" | "sell";
  readonly account: Address;
  readonly owner: Address;
  readonly accountIndex: number;
  readonly token: Address;
  readonly curve: Address;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly amountIn: string;
  readonly expectedAmountOut: string;
  readonly minimumAmountOut: string;
  readonly slippageBps: number;
}

export interface TradePosition {
  readonly account: Address;
  readonly token: Address;
  readonly curve: Address;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly tokenBalance: string;
  readonly usdgBalance: string;
}

export interface TradeSubmission {
  readonly requestId: string;
  readonly status: "queued" | "submitted";
  readonly account: Address;
  readonly transactionHash?: Hash;
}

export interface TradeApplicationOptions {
  readonly publicClient: PublicClient;
  readonly relay: RelayExecution;
  readonly store: TradeApplicationStore;
  readonly submissionEnabled: boolean;
  readonly now?: () => number;
  readonly previewTtlMs?: number;
}

export class TradeApplicationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TradeApplicationError";
  }
}

export class PonsTradeApplication {
  private readonly now: () => number;
  private readonly previewTtlMs: number;

  constructor(private readonly options: TradeApplicationOptions) {
    this.now = options.now ?? Date.now;
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
  }

  async position(value: unknown): Promise<TradePosition> {
    const input = record(value, "position");
    const account = address(input.account, "position.account");
    const token = address(input.token, "position.token");
    const launch = await this.resolveActiveLaunch(token);
    const [tokenSymbol, tokenDecimals, tokenBalance, usdgBalance] =
      await Promise.all([
        this.options.publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "symbol",
        }),
        this.options.publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        }),
        this.options.publicClient.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
        this.options.publicClient.readContract({
          address: PONS_V2_ROBINHOOD.usdg,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account],
        }),
      ]);
    return {
      account,
      token,
      curve: getAddress(launch.curve),
      tokenSymbol,
      tokenDecimals,
      tokenBalance: tokenBalance.toString(),
      usdgBalance: usdgBalance.toString(),
    };
  }

  async preview(value: unknown): Promise<TradePreview> {
    const input = parsePreviewInput(value);
    await this.assertFactoryAccount(input);
    const position = await this.position({
      account: input.account,
      token: input.token,
    });
    if (input.side === "buy" && BigInt(position.usdgBalance) < input.amount) {
      throw new TradeApplicationError(
        409,
        "R2 USDG balance is below the buy amount",
      );
    }
    if (input.side === "sell" && BigInt(position.tokenBalance) < input.amount) {
      throw new TradeApplicationError(
        409,
        "R2 token balance is below the sell amount",
      );
    }
    const buyQuote =
      input.side === "buy"
        ? await quotePonsV2Buy(
            this.options.publicClient,
            position.curve,
            input.amount,
            input.account,
          )
        : undefined;
    const expectedAmountOut = buyQuote
      ? buyQuote.tokensOut
      : await quotePonsV2Sell(
          this.options.publicClient,
          position.curve,
          input.amount,
        );
    const minimumAmountOut = buyQuote
      ? buyMinimumFromQuote(buyQuote, input.amount, input.slippageBps)
      : applySlippage(expectedAmountOut, input.slippageBps);
    const timestamp = this.now();
    const expiresAt = timestamp + this.previewTtlMs;
    const previewId = randomUUID();
    await this.options.store.putPreview({
      previewId,
      side: input.side,
      account: input.account,
      owner: input.owner,
      accountIndex: input.accountIndex,
      token: input.token,
      curve: position.curve,
      amountIn: input.amount.toString(),
      minimumAmountOut: minimumAmountOut.toString(),
      slippageBps: input.slippageBps,
      expiresAt,
      createdAt: timestamp,
    });
    return {
      previewId,
      expiresAt: new Date(expiresAt).toISOString(),
      side: input.side,
      account: input.account,
      owner: input.owner,
      accountIndex: input.accountIndex,
      token: input.token,
      curve: position.curve,
      tokenSymbol: position.tokenSymbol,
      tokenDecimals: position.tokenDecimals,
      amountIn: input.amount.toString(),
      expectedAmountOut: expectedAmountOut.toString(),
      minimumAmountOut: minimumAmountOut.toString(),
      slippageBps: input.slippageBps,
    };
  }

  async submit(input: {
    readonly previewId: unknown;
    readonly idempotencyKey: unknown;
    readonly relayRequest: RelayExecutionRequest;
  }): Promise<TradeSubmission> {
    if (!this.options.submissionEnabled) {
      throw new TradeApplicationError(
        503,
        "mainnet trade submission is disabled",
      );
    }
    const previewId = uuid(input.previewId, "previewId");
    const idempotencyKey = uuid(input.idempotencyKey, "idempotencyKey");
    const preview = await this.options.store.getPreview(previewId);
    if (!preview)
      throw new TradeApplicationError(404, "trade preview not found");
    if (preview.expiresAt < this.now()) {
      throw new TradeApplicationError(409, "trade preview expired");
    }
    const request = input.relayRequest;
    assertRequestRoute(request, preview);
    assertTradeMatchesPreview(request, preview);
    const valid = await verifyTypedData({
      address: request.owner,
      ...executionTypedData({
        chainId: request.chainId,
        account: request.account,
        calls: request.calls,
        nonce: request.nonce,
        deadline: request.deadline,
        fee: request.fee,
        prefund: request.prefund,
      }),
      signature: request.signature,
    });
    if (!valid)
      throw new TradeApplicationError(400, "invalid O2 trade signature");
    await validatePonsV2Calls(request, this.options.publicClient);
    const requestHash = keccak256(
      stringToHex(JSON.stringify(relayExecutionRequestJson(request))),
    );
    const timestamp = this.now();
    const pending: StoredTradeSubmission = {
      idempotencyKey,
      previewId,
      requestHash,
      state: "pending",
      requestId: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const reservation = await this.options.store.reserveSubmission(pending);
    if (!reservation.created) {
      return submissionResponse(reservation.record, request.account);
    }
    try {
      const transactionHash = await this.options.relay(request);
      return submissionResponse(
        await this.options.store.completeSubmission(
          idempotencyKey,
          transactionHash,
          this.now(),
        ),
        request.account,
      );
    } catch (error) {
      if (error instanceof RelayerRejectedError && !error.broadcasted) {
        await this.options.store.releaseSubmission(idempotencyKey, requestHash);
        throw new TradeApplicationError(400, error.message);
      }
      throw new TradeApplicationError(
        502,
        "relayer outcome is unknown; retry this same reviewed trade",
      );
    }
  }

  async status(value: unknown) {
    const input = record(value, "status");
    const transactionHash = hash(
      input.transactionHash,
      "status.transactionHash",
    );
    const account = address(input.account, "status.account");
    const token = address(input.token, "status.token");
    try {
      const receipt = await this.options.publicClient.getTransactionReceipt({
        hash: transactionHash,
      });
      if (receipt.status !== "success") {
        return { status: "reverted" as const, transactionHash };
      }
      return {
        status: "success" as const,
        transactionHash,
        position: await this.position({ account, token }),
      };
    } catch (error) {
      if (
        (error as { name?: string }).name === "TransactionReceiptNotFoundError"
      ) {
        return { status: "pending" as const, transactionHash };
      }
      throw error;
    }
  }

  private async assertFactoryAccount(account: TradeAccount): Promise<void> {
    const predicted = await this.options.publicClient.readContract({
      address: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
      abi: ponsPrivacyAccountFactoryAbi,
      functionName: "computeAddress",
      args: [account.owner, BigInt(account.accountIndex)],
    });
    if (!isAddressEqual(predicted, account.account)) {
      throw new TradeApplicationError(
        400,
        "R2 does not match the factory owner/index",
      );
    }
  }

  private async resolveActiveLaunch(token: Address) {
    const launch = await this.options.publicClient.readContract({
      address: PONS_V2_ROBINHOOD.factory,
      abi: ponsV2FactoryAbi,
      functionName: "getLaunchedToken",
      args: [token],
    });
    if (
      !launch.exists ||
      launch.phase !== 0 ||
      !isAddressEqual(launch.token, token) ||
      !isAddressEqual(launch.pairToken, PONS_V2_ROBINHOOD.usdg)
    ) {
      throw new TradeApplicationError(
        400,
        "token is not an active Pons USDG launch",
      );
    }
    return launch;
  }
}

function parsePreviewInput(value: unknown): TradeAccount & {
  side: "buy" | "sell";
  token: Address;
  amount: bigint;
  slippageBps: number;
} {
  const input = record(value, "trade");
  if (input.side !== "buy" && input.side !== "sell") {
    throw new TradeApplicationError(400, "trade.side must be buy or sell");
  }
  const amount = unsigned(input.amount, "trade.amount");
  if (amount <= 0n)
    throw new TradeApplicationError(400, "trade.amount must be positive");
  const slippageBps = safeInteger(input.slippageBps, "trade.slippageBps");
  if (slippageBps > MAX_APPLICATION_SLIPPAGE_BPS) {
    throw new TradeApplicationError(400, "trade slippage exceeds 10%");
  }
  return {
    side: input.side,
    token: address(input.token, "trade.token"),
    amount,
    slippageBps,
    account: address(input.account, "trade.account"),
    owner: address(input.owner, "trade.owner"),
    accountIndex: safeInteger(input.accountIndex, "trade.accountIndex"),
  };
}

function assertRequestRoute(
  request: RelayExecutionRequest,
  preview: { account: string; owner: string; accountIndex: number },
): void {
  if (
    request.policyContext ||
    request.chainId !== ROBINHOOD_MAINNET_CHAIN_ID ||
    !isAddressEqual(request.factory, PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD) ||
    !isAddressEqual(request.account, preview.account as Address) ||
    !isAddressEqual(request.owner, preview.owner as Address) ||
    request.accountIndex !== preview.accountIndex ||
    request.prefund !== 0n ||
    !isAddressEqual(request.fee.token, NO_RELAYER_FEE.token) ||
    request.fee.amount !== 0n ||
    !isAddressEqual(request.fee.recipient, NO_RELAYER_FEE.recipient)
  ) {
    throw new TradeApplicationError(
      400,
      "signed trade route changed after preview",
    );
  }
}

function assertTradeMatchesPreview(
  request: RelayExecutionRequest,
  preview: {
    side: "buy" | "sell";
    token: string;
    curve: string;
    amountIn: string;
    minimumAmountOut: string;
  },
): void {
  const [approvalCall, tradeCall] = request.calls;
  if (!approvalCall || !tradeCall || request.calls.length !== 2) {
    throw new TradeApplicationError(400, "signed trade must contain two calls");
  }
  let approval: ReturnType<typeof decodeFunctionData<typeof erc20Abi>>;
  let trade: ReturnType<typeof decodeFunctionData<typeof ponsV2CurveAbi>>;
  try {
    approval = decodeFunctionData({ abi: erc20Abi, data: approvalCall.data });
    trade = decodeFunctionData({ abi: ponsV2CurveAbi, data: tradeCall.data });
  } catch {
    throw new TradeApplicationError(400, "signed trade calldata is invalid");
  }
  const expectedTarget =
    preview.side === "buy"
      ? PONS_V2_ROBINHOOD.usdg
      : (preview.token as Address);
  if (
    approval.functionName !== "approve" ||
    trade.functionName !== preview.side ||
    !isAddressEqual(approvalCall.target, expectedTarget) ||
    !isAddressEqual(approval.args[0], preview.curve as Address) ||
    approval.args[1] !== BigInt(preview.amountIn) ||
    !isAddressEqual(tradeCall.target, preview.curve as Address) ||
    trade.args[0] !== BigInt(preview.amountIn) ||
    trade.args[1] !== BigInt(preview.minimumAmountOut) ||
    !isAddressEqual(trade.args[2], request.account)
  ) {
    throw new TradeApplicationError(400, "signed trade changed after preview");
  }
}

function submissionResponse(
  record: StoredTradeSubmission,
  account: Address,
): TradeSubmission {
  return {
    requestId: record.requestId,
    status: record.state === "submitted" ? "submitted" : "queued",
    account,
    ...(record.transactionHash
      ? { transactionHash: record.transactionHash as Hash }
      : {}),
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TradeApplicationError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value) || BigInt(value) === 0n) {
    throw new TradeApplicationError(400, `${field} must be a non-zero address`);
  }
  return getAddress(value);
}

function unsigned(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new TradeApplicationError(
      400,
      `${field} must be an unsigned integer`,
    );
  }
  return BigInt(value);
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TradeApplicationError(400, `${field} must be a safe integer`);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new TradeApplicationError(400, `${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function hash(value: unknown, field: string): Hash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new TradeApplicationError(400, `${field} must be a transaction hash`);
  }
  return value as Hash;
}
