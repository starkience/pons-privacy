import type { Address, Hash, PublicClient } from "viem";
import { ponsPrivacyAccountAbi, ponsPrivacyAccountFactoryAbi } from "./abi.js";
import {
  ponsV2Adapter,
  type PonsV2Adapter,
  type PonsV2BuyIntent,
  type PonsV2LaunchIntent,
  type PonsV2SellIntent,
} from "./adapters/pons-v2.js";
import { signExecution } from "./execution.js";
import {
  NO_RELAYER_FEE,
  type ExecuteOptions,
  type ExecutionCall,
  type ExecutionOwnerDeriver,
  type PonsPrivacySession,
  type RelayExecution,
  type RelayExecutionRequest,
} from "./types.js";

const DEFAULT_CHANNEL = "pons-privacy-v1";
const DEFAULT_DEADLINE_SECONDS = 10 * 60;

export interface PonsPrivacyClientConfig {
  chainId: number;
  factory: Address;
  publicClient: PublicClient;
  ownerDeriver: ExecutionOwnerDeriver;
  relay: RelayExecution;
  channel?: string;
}

export class PonsPrivacyClient {
  readonly channel: string;

  constructor(readonly config: PonsPrivacyClientConfig) {
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) {
      throw new Error("chainId must be a positive safe integer");
    }
    this.channel = config.channel ?? DEFAULT_CHANNEL;
  }

  async deriveSession(
    identitySignature: string,
    accountIndex: number,
  ): Promise<PonsPrivacySession> {
    if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
      throw new Error("accountIndex must be a non-negative safe integer");
    }
    const owner = this.config.ownerDeriver.deriveEvmOwner(
      identitySignature,
      accountIndex,
      this.channel,
    ).address;
    const account = await this.config.publicClient.readContract({
      address: this.config.factory,
      abi: ponsPrivacyAccountFactoryAbi,
      functionName: "computeAddress",
      args: [owner, BigInt(accountIndex)],
    });
    return { accountIndex, channel: this.channel, owner, account };
  }

  async execute(
    identitySignature: string,
    session: PonsPrivacySession,
    calls: readonly ExecutionCall[],
    options: ExecuteOptions = {},
  ): Promise<Hash> {
    const request = await this.prepareRelayRequest(
      identitySignature,
      session,
      calls,
      options,
    );
    return this.config.relay(request);
  }

  async launch(args: {
    identitySignature: string;
    session: PonsPrivacySession;
    intent: PonsV2LaunchIntent;
    adapter?: PonsV2Adapter;
    options?: ExecuteOptions;
  }): Promise<Hash> {
    const adapter = args.adapter ?? ponsV2Adapter();
    this.assertAdapterChain(adapter);
    const calls = await adapter.buildLaunchCalls(args.intent, {
      account: args.session.account,
      publicClient: this.config.publicClient,
    });
    const prefund = calls.reduce((total, call) => total + call.value, 0n);
    if (
      args.options?.prefund !== undefined &&
      args.options.prefund !== prefund
    ) {
      throw new Error(
        "Pons launch prefund must equal the encoded native value",
      );
    }
    return this.execute(args.identitySignature, args.session, calls, {
      ...args.options,
      prefund,
    });
  }

  async buy(args: {
    identitySignature: string;
    session: PonsPrivacySession;
    intent: PonsV2BuyIntent;
    adapter?: PonsV2Adapter;
    options?: ExecuteOptions;
  }): Promise<Hash> {
    const adapter = args.adapter ?? ponsV2Adapter();
    this.assertAdapterChain(adapter);
    this.assertNoTradePrefund(args.options);
    const calls = await adapter.buildOpenCalls(args.intent, {
      account: args.session.account,
      publicClient: this.config.publicClient,
    });
    return this.execute(args.identitySignature, args.session, calls, {
      ...args.options,
      prefund: 0n,
    });
  }

  async sell(args: {
    identitySignature: string;
    session: PonsPrivacySession;
    intent: PonsV2SellIntent;
    adapter?: PonsV2Adapter;
    options?: ExecuteOptions;
  }): Promise<Hash> {
    const adapter = args.adapter ?? ponsV2Adapter();
    this.assertAdapterChain(adapter);
    this.assertNoTradePrefund(args.options);
    const calls = await adapter.buildCloseCalls(args.intent, {
      account: args.session.account,
      publicClient: this.config.publicClient,
    });
    return this.execute(args.identitySignature, args.session, calls, {
      ...args.options,
      prefund: 0n,
    });
  }

  async prepareRelayRequest(
    identitySignature: string,
    session: PonsPrivacySession,
    calls: readonly ExecutionCall[],
    options: ExecuteOptions = {},
  ): Promise<RelayExecutionRequest> {
    if (calls.length === 0)
      throw new Error("cannot execute an empty call batch");
    const derived = this.config.ownerDeriver.deriveEvmOwner(
      identitySignature,
      session.accountIndex,
      session.channel,
    );
    if (derived.address.toLowerCase() !== session.owner.toLowerCase()) {
      throw new Error(
        "identity signature does not control this Pons privacy session",
      );
    }

    const code = await this.config.publicClient.getBytecode({
      address: session.account,
    });
    const nonce = code
      ? await this.config.publicClient.readContract({
          address: session.account,
          abi: ponsPrivacyAccountAbi,
          functionName: "nonce",
        })
      : 0n;
    const deadlineSeconds = options.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
    if (!Number.isSafeInteger(deadlineSeconds) || deadlineSeconds <= 0) {
      throw new Error("deadlineSeconds must be a positive safe integer");
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    const prefund = options.prefund ?? 0n;
    const fee = options.fee ?? NO_RELAYER_FEE;
    const signedCalls = [...calls];
    const signature = await signExecution({
      privateKey: derived.privateKey,
      chainId: this.config.chainId,
      account: session.account,
      calls: signedCalls,
      nonce,
      deadline,
      fee,
      prefund,
    });
    return {
      chainId: this.config.chainId,
      factory: this.config.factory,
      account: session.account,
      owner: session.owner,
      accountIndex: session.accountIndex,
      calls: signedCalls,
      nonce,
      deadline,
      prefund,
      fee,
      signature,
    };
  }

  private assertAdapterChain(adapter: PonsV2Adapter): void {
    if (adapter.chainId !== this.config.chainId) {
      throw new Error("Pons adapter chain does not match the client");
    }
  }

  private assertNoTradePrefund(options: ExecuteOptions | undefined): void {
    if (options?.prefund !== undefined && options.prefund !== 0n) {
      throw new Error("Pons curve trades cannot request a native prefund");
    }
  }
}
