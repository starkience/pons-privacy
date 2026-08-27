import { randomUUID } from "node:crypto";
import {
  decodeFunctionData,
  formatEther,
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
  executionTypedData,
  NO_RELAYER_FEE,
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PONS_V2_ROBINHOOD,
  ponsPrivacyAccountFactoryAbi,
  ponsV2Adapter,
  ponsV2FactoryAbi,
  relayExecutionRequestJson,
  RelayerRejectedError,
  ROBINHOOD_MAINNET_CHAIN_ID,
  erc20Abi,
  type RelayExecution,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";
import { validatePonsV2Calls } from "./pons-v2-policy.js";
import type {
  LaunchApplicationStore,
  StoredLaunchSubmission,
} from "./launch-application-store.js";

const PREVIEW_SALT = `0x${"01".repeat(32)}` as const;
const DEFAULT_PREVIEW_TTL_MS = 10 * 60_000;
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

export interface ApplicationLaunchDraft {
  readonly name: string;
  readonly symbol: string;
  readonly logo: string;
  readonly description: string;
  readonly socials: {
    readonly twitter: string;
    readonly telegram: string;
    readonly discord: string;
    readonly website: string;
    readonly farcaster: string;
  };
  readonly creatorTaxBps: number;
  readonly buybackEnabled: boolean;
  readonly launchConfigId: number;
}

export interface ApplicationLaunchAccount {
  readonly account: Address;
  readonly owner: Address;
  readonly accountIndex: number;
}

export interface ApplicationLaunchPreview extends ApplicationLaunchAccount {
  readonly previewId: string;
  readonly expiresAt: string;
  readonly chainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  readonly chainName: "Robinhood Chain";
  readonly privacyAccount: Address;
  readonly ponsFactory: Address;
  readonly accountFactory: Address;
  readonly pairToken: Address;
  readonly launchFeeWei: string;
  readonly launchFeeEth: string;
  readonly creatorTaxMaximumBps: number;
  readonly economicsPinned: true;
  readonly fundingBalance: string;
  readonly route: readonly string[];
}

export interface ApplicationLaunchSubmission {
  readonly requestId: string;
  readonly status: "queued" | "submitted";
  readonly privacyAccount: Address;
  readonly transactionHash?: Hash;
}

export interface LaunchApplicationOptions {
  readonly publicClient: PublicClient;
  readonly relay: RelayExecution;
  readonly store: LaunchApplicationStore;
  readonly submissionEnabled: boolean;
  readonly now?: () => number;
  readonly previewTtlMs?: number;
}

export class LaunchApplicationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LaunchApplicationError";
  }
}

export class PonsLaunchApplication {
  private readonly now: () => number;
  private readonly previewTtlMs: number;

  constructor(private readonly options: LaunchApplicationOptions) {
    this.now = options.now ?? Date.now;
    this.previewTtlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
    if (!Number.isSafeInteger(this.previewTtlMs) || this.previewTtlMs <= 0) {
      throw new Error("preview TTL must be a positive safe integer");
    }
  }

  async preview(
    draftValue: unknown,
    accountValue: unknown,
  ): Promise<ApplicationLaunchPreview> {
    const draft = parseApplicationLaunchDraft(draftValue);
    const launchAccount = parseApplicationLaunchAccount(accountValue);
    await this.assertFactoryAccount(launchAccount);
    const fundingBalance = await this.options.publicClient.readContract({
      address: PONS_V2_ROBINHOOD.usdg,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [launchAccount.account],
    });
    if (fundingBalance <= 0n) {
      throw new LaunchApplicationError(
        409,
        "R2 has not received the private funding route",
      );
    }
    const calls = await ponsV2Adapter().buildLaunchCalls(
      launchIntent(draft, PREVIEW_SALT),
      {
        account: launchAccount.account,
        publicClient: this.options.publicClient,
      },
    );
    const launchFee = calls.reduce((total, call) => total + call.value, 0n);
    const maximumTax = await this.options.publicClient.readContract({
      address: PONS_V2_ROBINHOOD.factory,
      abi: ponsV2FactoryAbi,
      functionName: "maxCreatorTaxBps",
    });
    const timestamp = this.now();
    const expiresAt = timestamp + this.previewTtlMs;
    const previewId = randomUUID();
    await this.options.store.putPreview({
      previewId,
      draftHash: draftHash(draft),
      account: launchAccount.account,
      owner: launchAccount.owner,
      accountIndex: launchAccount.accountIndex,
      expiresAt,
      createdAt: timestamp,
    });
    return {
      previewId,
      expiresAt: new Date(expiresAt).toISOString(),
      chainId: ROBINHOOD_MAINNET_CHAIN_ID,
      chainName: "Robinhood Chain",
      privacyAccount: launchAccount.account,
      ...launchAccount,
      ponsFactory: PONS_V2_ROBINHOOD.factory,
      accountFactory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
      pairToken: PONS_V2_ROBINHOOD.usdg,
      launchFeeWei: launchFee.toString(),
      launchFeeEth: formatEther(launchFee),
      creatorTaxMaximumBps: Number(maximumTax),
      economicsPinned: true,
      fundingBalance: fundingBalance.toString(),
      route: [
        "Browser-held O2 signature",
        "Counterfactual R2 execution account",
        "Pons V2 policy relayer",
      ],
    };
  }

  async submit(input: {
    readonly draft: unknown;
    readonly previewId: unknown;
    readonly idempotencyKey: unknown;
    readonly relayRequest: RelayExecutionRequest;
  }): Promise<ApplicationLaunchSubmission> {
    if (!this.options.submissionEnabled) {
      throw new LaunchApplicationError(
        503,
        "mainnet launch submission is disabled",
      );
    }
    const draft = parseApplicationLaunchDraft(input.draft);
    const previewId = uuid(input.previewId, "previewId");
    const idempotencyKey = uuid(input.idempotencyKey, "idempotencyKey");
    const preview = await this.options.store.getPreview(previewId);
    if (!preview)
      throw new LaunchApplicationError(404, "launch preview not found");
    if (preview.expiresAt < this.now()) {
      throw new LaunchApplicationError(409, "launch preview expired");
    }
    if (preview.draftHash !== draftHash(draft)) {
      throw new LaunchApplicationError(
        409,
        "launch draft changed after preview",
      );
    }
    const request = input.relayRequest;
    assertRequestRoute(request, preview);
    await this.assertFactoryAccount({
      account: getAddress(preview.account),
      owner: getAddress(preview.owner),
      accountIndex: preview.accountIndex,
    });
    assertLaunchMatchesDraft(request, draft);
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
      throw new LaunchApplicationError(400, "invalid O2 launch signature");
    await validatePonsV2Calls(request, this.options.publicClient);

    const requestHash = keccak256(
      stringToHex(JSON.stringify(relayExecutionRequestJson(request))),
    );
    const timestamp = this.now();
    const pending: StoredLaunchSubmission = {
      idempotencyKey,
      previewId,
      requestHash,
      state: "pending",
      requestId: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const reservation = await this.options.store.reserveSubmission(pending);
    if (!reservation.created)
      return submissionResponse(reservation.record, request.account);

    try {
      const transactionHash = await this.options.relay(request);
      const completed = await this.options.store.completeSubmission(
        idempotencyKey,
        transactionHash,
        this.now(),
      );
      return submissionResponse(completed, request.account);
    } catch (error) {
      if (error instanceof RelayerRejectedError && !error.broadcasted) {
        await this.options.store.releaseSubmission(idempotencyKey, requestHash);
        throw new LaunchApplicationError(400, error.message);
      }
      throw new LaunchApplicationError(
        502,
        "relayer outcome is unknown; retry this same reviewed launch",
      );
    }
  }

  private async assertFactoryAccount(account: ApplicationLaunchAccount) {
    const predicted = await this.options.publicClient.readContract({
      address: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
      abi: ponsPrivacyAccountFactoryAbi,
      functionName: "computeAddress",
      args: [account.owner, BigInt(account.accountIndex)],
    });
    if (!isAddressEqual(predicted, account.account)) {
      throw new LaunchApplicationError(
        400,
        "R2 does not match the deployed factory owner/index",
      );
    }
  }
}

function submissionResponse(
  record: StoredLaunchSubmission,
  account: Address,
): ApplicationLaunchSubmission {
  return {
    requestId: record.requestId,
    status: record.state === "submitted" ? "submitted" : "queued",
    privacyAccount: account,
    ...(record.transactionHash
      ? { transactionHash: record.transactionHash as Hash }
      : {}),
  };
}

function assertRequestRoute(
  request: RelayExecutionRequest,
  preview: {
    readonly account: string;
    readonly owner: string;
    readonly accountIndex: number;
  },
): void {
  if (
    request.chainId !== ROBINHOOD_MAINNET_CHAIN_ID ||
    !isAddressEqual(request.factory, PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD) ||
    !isAddressEqual(request.account, preview.account as Address) ||
    !isAddressEqual(request.owner, preview.owner as Address) ||
    request.accountIndex !== preview.accountIndex ||
    !isAddressEqual(request.fee.token, NO_RELAYER_FEE.token) ||
    request.fee.amount !== NO_RELAYER_FEE.amount ||
    !isAddressEqual(request.fee.recipient, NO_RELAYER_FEE.recipient)
  ) {
    throw new LaunchApplicationError(
      400,
      "signed launch route changed after preview",
    );
  }
}

function assertLaunchMatchesDraft(
  request: RelayExecutionRequest,
  draft: ApplicationLaunchDraft,
): void {
  if (
    request.calls.length !== 1 ||
    !isAddressEqual(request.calls[0]!.target, PONS_V2_ROBINHOOD.factory) ||
    request.prefund !== request.calls[0]!.value
  ) {
    throw new LaunchApplicationError(
      400,
      "signed request is not one exact Pons launch",
    );
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof ponsV2FactoryAbi>>;
  try {
    decoded = decodeFunctionData({
      abi: ponsV2FactoryAbi,
      data: request.calls[0]!.data,
    });
  } catch {
    throw new LaunchApplicationError(
      400,
      "signed Pons launch calldata is invalid",
    );
  }
  if (decoded.functionName !== "launchToken") {
    throw new LaunchApplicationError(
      400,
      "signed Pons selector is not launchToken",
    );
  }
  const [params, configId, pairToken] = decoded.args;
  const expected = launchIntent(draft, params.salt);
  const expectedSocials = expected.socials!;
  if (
    params.name !== expected.name ||
    params.symbol !== expected.symbol ||
    params.logo !== expected.logo ||
    params.description !== expected.description ||
    params.socials.twitter !== expectedSocials.twitter ||
    params.socials.telegram !== expectedSocials.telegram ||
    params.socials.discord !== expectedSocials.discord ||
    params.socials.website !== expectedSocials.website ||
    params.socials.farcaster !== expectedSocials.farcaster ||
    !isAddressEqual(params.creatorFeeRecipient, request.account) ||
    Number(params.creatorTaxBps) !== expected.creatorTaxBps ||
    params.buybackEnabled !== expected.buybackEnabled ||
    configId !== expected.launchConfigId ||
    !isAddressEqual(pairToken, PONS_V2_ROBINHOOD.usdg) ||
    params.salt === ZERO_BYTES32
  ) {
    throw new LaunchApplicationError(
      400,
      "signed launch metadata changed after preview",
    );
  }
}

function launchIntent(draft: ApplicationLaunchDraft, salt: `0x${string}`) {
  return {
    name: draft.name,
    symbol: draft.symbol,
    logo: draft.logo,
    description: draft.description,
    socials: { ...draft.socials },
    creatorTaxBps: draft.creatorTaxBps,
    buybackEnabled: draft.buybackEnabled,
    launchConfigId: BigInt(draft.launchConfigId),
    salt,
  } as const;
}

export function parseApplicationLaunchDraft(
  value: unknown,
): ApplicationLaunchDraft {
  const input = record(value, "draft");
  const socials = record(input.socials, "draft.socials");
  const draft: ApplicationLaunchDraft = {
    name: boundedText(input.name, "draft.name", 1, 64).trim(),
    symbol: boundedText(input.symbol, "draft.symbol", 1, 16)
      .trim()
      .toUpperCase(),
    logo: boundedText(input.logo, "draft.logo", 0, 512),
    description: boundedText(input.description, "draft.description", 0, 2_048),
    socials: {
      twitter: boundedText(socials.twitter, "draft.socials.twitter", 0, 256),
      telegram: boundedText(socials.telegram, "draft.socials.telegram", 0, 256),
      discord: boundedText(socials.discord, "draft.socials.discord", 0, 256),
      website: boundedText(socials.website, "draft.socials.website", 0, 256),
      farcaster: boundedText(
        socials.farcaster,
        "draft.socials.farcaster",
        0,
        256,
      ),
    },
    creatorTaxBps: safeInteger(
      input.creatorTaxBps,
      "draft.creatorTaxBps",
      10_000,
    ),
    buybackEnabled: boolean(input.buybackEnabled, "draft.buybackEnabled"),
    launchConfigId: safeInteger(input.launchConfigId, "draft.launchConfigId"),
  };
  if (!draft.name || !draft.symbol) {
    throw new LaunchApplicationError(400, "token name and symbol are required");
  }
  return draft;
}

function parseApplicationLaunchAccount(
  value: unknown,
): ApplicationLaunchAccount {
  const input = record(value, "launchAccount");
  return {
    account: address(input.account, "launchAccount.account"),
    owner: address(input.owner, "launchAccount.owner"),
    accountIndex: safeInteger(input.accountIndex, "launchAccount.accountIndex"),
  };
}

function draftHash(draft: ApplicationLaunchDraft): string {
  return keccak256(stringToHex(JSON.stringify(draft)));
}

function uuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new LaunchApplicationError(400, `${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LaunchApplicationError(400, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value) || BigInt(value) === 0n) {
    throw new LaunchApplicationError(
      400,
      `${field} must be a non-zero address`,
    );
  }
  return getAddress(value);
}

function boundedText(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new LaunchApplicationError(400, `${field} must be a string`);
  }
  const bytes = new TextEncoder().encode(value).length;
  if (bytes < minimum || bytes > maximum) {
    throw new LaunchApplicationError(
      400,
      `${field} must contain ${minimum}-${maximum} UTF-8 bytes`,
    );
  }
  return value;
}

function safeInteger(
  value: unknown,
  field: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  ) {
    throw new LaunchApplicationError(400, `${field} must be a safe integer`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new LaunchApplicationError(400, `${field} must be boolean`);
  }
  return value;
}
