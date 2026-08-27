import type { DerivedPonsPrivacyIdentity } from "@pons-privacy/sdk";
import {
  IndexerDiscoveryProvider,
  ProvingServiceProofProvider,
  WarningCode,
  createPrivateTransfers,
  type Note,
  type PrivateTransfersInterface,
  type Warning,
} from "@starkware-libs/starknet-privacy-sdk";
import { Account, RpcProvider, constants, ec, type Call } from "starknet";
import { requireStarknetAddress, type Strk20NetworkConfig } from "./config.js";
import { STRK20_MAINNET } from "./constants.js";
import {
  AvnuPrivatePaymasterGateway,
  type PrivatePaymasterGateway,
} from "./private-paymaster.js";

export interface UserStrk20Config extends Strk20NetworkConfig {
  readonly usdcAddress: string;
  /** Same-origin production proxy; the AVNU API key stays server-side. */
  readonly privatePaymasterUrl: string;
  /** Absolute USDC cap accepted from AVNU's proof fee_action. */
  readonly maxPrivatePaymasterFee: bigint;
}

export interface UserStrk20WithdrawalRequest {
  readonly amount: bigint;
  /** Fresh per-operation Starknet account, never the root-linked account. */
  readonly transportAccountAddress: string;
  readonly previousTransactionHash?: string;
  readonly onRelayStart?: () => void | Promise<void>;
  readonly onTransactionHash?: (hash: string) => void | Promise<void>;
}

export interface UserStrk20WithdrawalResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly token: string;
  readonly amount: bigint;
  readonly transportAccountAddress: string;
  readonly provingBlockNumber: number;
  readonly poolFee: bigint;
  readonly warnings: readonly Warning[];
  readonly recovered: boolean;
}

export interface UserStrk20DepositRequest {
  /** Actual USDC output reported by LayerSwap's completed output transaction. */
  readonly amount: bigint;
  readonly fundingTransactionHash: string;
  /** Fresh S1 deploy block, when deployment happened in this operation. */
  readonly deploymentBlockNumber?: number;
  /** Reconcile this exact hash before any possible re-submit. */
  readonly previousTransactionHash?: string;
  readonly onRelayStart?: () => void | Promise<void>;
  readonly onTransactionHash?: (hash: string) => void | Promise<void>;
}

export interface UserStrk20DepositResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly token: string;
  readonly amount: bigint;
  readonly privateAmount?: bigint;
  readonly provingBlockNumber?: number;
  readonly poolFee?: bigint;
  readonly recovered: boolean;
  readonly warnings: readonly Warning[];
}

export interface MatureNoteSelection {
  readonly selected: readonly Note[];
  readonly selectedAmount: bigint;
  readonly privateBalance: bigint;
  readonly matureBalance: bigint;
}

export class UserStrk20Session {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: RpcProvider,
    private readonly account: Account,
    private readonly transfers: PrivateTransfersInterface,
    private readonly paymaster: PrivatePaymasterGateway,
    private readonly poolAddress: string,
    private readonly usdcAddress: string,
    private readonly viewingKey: bigint,
    private readonly maxPrivatePaymasterFee: bigint,
  ) {}

  withdrawToTransport(
    request: UserStrk20WithdrawalRequest,
  ): Promise<UserStrk20WithdrawalResult> {
    const result = this.queue.then(() => this.withdrawExclusive(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  depositFromPublicBalance(
    request: UserStrk20DepositRequest,
  ): Promise<UserStrk20DepositResult> {
    const result = this.queue.then(() => this.depositExclusive(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async depositExclusive(
    request: UserStrk20DepositRequest,
  ): Promise<UserStrk20DepositResult> {
    if (request.amount <= 0n) {
      throw new Error("STRK20 deposit amount must be positive");
    }

    if (request.previousTransactionHash) {
      const prior = await this.provider.waitForTransaction(
        request.previousTransactionHash,
      );
      if (prior.isSuccess()) {
        if (prior.block_number === undefined) {
          throw new Error(
            "recovered STRK20 deposit receipt has no block number",
          );
        }
        return {
          transactionHash: request.previousTransactionHash,
          blockNumber: prior.block_number,
          token: this.usdcAddress,
          amount: request.amount,
          recovered: true,
          warnings: [],
        };
      }
      this.transfers.invalidateProofNonceCache();
    }

    const fundingReceipt = await this.provider.waitForTransaction(
      request.fundingTransactionHash,
    );
    if (!fundingReceipt.isSuccess()) {
      throw new Error("LayerSwap Starknet output transaction did not succeed");
    }
    if (fundingReceipt.block_number === undefined) {
      throw new Error("LayerSwap output receipt has no block number");
    }

    const balance = await this.readPublicUsdcBalance();
    if (balance < request.amount) {
      throw new Error(
        "S1 USDC balance is below LayerSwap's completed output amount",
      );
    }

    const autoRegister = await this.shouldAutoRegister();
    const approveCall = this.depositApproveCall(request.amount);
    const paymasterBuild = await this.paymaster.buildInvokeAndPoolAction(
      this.poolAddress,
      this.usdcAddress,
      this.account.address,
      [approveCall],
    );
    const fee = paymasterBuild.feeAction;
    if (fee && BigInt(fee.token) !== BigInt(this.usdcAddress)) {
      throw new Error(
        "private paymaster fee must use the configured USDC token",
      );
    }
    const poolFee = fee?.amount ?? 0n;
    if (poolFee > this.maxPrivatePaymasterFee) {
      throw new Error("private paymaster fee exceeds the configured maximum");
    }
    if (poolFee >= request.amount) {
      throw new Error("STRK20 deposit amount does not cover the private fee");
    }

    const dependencyBlock = Math.max(
      fundingReceipt.block_number,
      request.deploymentBlockNumber ?? 0,
    );
    const provingBlockNumber = await waitForSettledProvingBlock(
      this.provider,
      dependencyBlock,
    );
    const builder = this.transfers
      .build({
        autoRegister,
        autoSetup: true,
        autoDiscover: { notes: "refresh", channels: "refresh" },
        autoSelectNotes: "naive",
        provingBlockId: provingBlockNumber,
      })
      .surplusTo(this.account.address)
      .with(this.usdcAddress, (token) => {
        if (fee && fee.amount > 0n) {
          token.deposit({ amount: request.amount });
          token.withdraw({ recipient: fee.recipient, amount: fee.amount });
        } else {
          token.deposit({
            amount: request.amount,
            recipient: this.account.address,
          });
        }
      });
    const invocation = await builder.createProofInvocation();
    const execution = await this.transfers.executeWithInvocation(
      invocation,
      provingBlockNumber,
    );
    const proof = execution.callAndProof.proof;
    let relayStarted = false;
    let submitted;
    try {
      submitted = await this.paymaster.executeInvokeAndPoolAction({
        poolAddress: this.poolAddress,
        call: execution.callAndProof.call as unknown as Call,
        proof: proof.data,
        proofFacts: proof.proofFacts ?? [],
        build: paymasterBuild,
        account: this.account,
        onRelayStart: async () => {
          relayStarted = true;
          await request.onRelayStart?.();
        },
      });
    } catch (error) {
      if (!relayStarted) this.transfers.invalidateProofNonceCache();
      if (relayStarted) {
        throw new Error(
          "STRK20 deposit relay outcome is unknown; do not resubmit until reconciled",
          { cause: error },
        );
      }
      throw error;
    }
    await request.onTransactionHash?.(submitted.transactionHash);
    const receipt = await this.provider.waitForTransaction(
      submitted.transactionHash,
    );
    if (!receipt.isSuccess()) {
      this.transfers.invalidateProofNonceCache();
      throw new Error(`STRK20 deposit reverted: ${submitted.transactionHash}`);
    }
    if (receipt.block_number === undefined) {
      throw new Error("STRK20 deposit receipt has no block number");
    }
    return {
      transactionHash: submitted.transactionHash,
      blockNumber: receipt.block_number,
      token: this.usdcAddress,
      amount: request.amount,
      privateAmount: request.amount - poolFee,
      provingBlockNumber,
      poolFee,
      recovered: false,
      warnings: execution.warnings,
    };
  }

  private async readPublicUsdcBalance(): Promise<bigint> {
    const [low, high] = await this.provider.callContract(
      {
        contractAddress: this.usdcAddress,
        entrypoint: "balance_of",
        calldata: [this.account.address],
      },
      "latest",
    );
    if (low === undefined || high === undefined) {
      throw new Error("USDC balance_of returned an unexpected value");
    }
    return BigInt(low) + (BigInt(high) << 128n);
  }

  private async shouldAutoRegister(): Promise<boolean> {
    const [registeredKey] = await this.provider.callContract(
      {
        contractAddress: this.poolAddress,
        entrypoint: "get_public_key",
        calldata: [this.account.address],
      },
      "latest",
    );
    if (registeredKey === undefined) {
      throw new Error("STRK20 registration check returned no public key");
    }
    if (BigInt(registeredKey) === 0n) return true;
    const expectedKey = BigInt(
      ec.starkCurve.getStarkKey(`0x${this.viewingKey.toString(16)}`),
    );
    if (BigInt(registeredKey) !== expectedKey) {
      throw new Error(
        "S1 is already registered with a different immutable viewing key",
      );
    }
    return false;
  }

  private depositApproveCall(amount: bigint): Call {
    const low = amount & ((1n << 128n) - 1n);
    const high = amount >> 128n;
    return {
      contractAddress: this.usdcAddress,
      entrypoint: "approve",
      calldata: [this.poolAddress, low.toString(), high.toString()],
    };
  }

  private async withdrawExclusive(
    request: UserStrk20WithdrawalRequest,
  ): Promise<UserStrk20WithdrawalResult> {
    if (request.amount <= 0n) {
      throw new Error("STRK20 withdrawal amount must be positive");
    }
    const transportAccountAddress = requireStarknetAddress(
      request.transportAccountAddress,
      "transportAccountAddress",
    );
    if (BigInt(transportAccountAddress) === BigInt(this.account.address)) {
      throw new Error(
        "the root-linked Starknet account must not initiate the outbound bridge",
      );
    }

    if (request.previousTransactionHash) {
      const prior = await this.provider.waitForTransaction(
        request.previousTransactionHash,
      );
      if (prior.isSuccess()) {
        if (prior.block_number === undefined) {
          throw new Error(
            "recovered STRK20 withdrawal receipt has no block number",
          );
        }
        return {
          transactionHash: request.previousTransactionHash,
          blockNumber: prior.block_number,
          token: this.usdcAddress,
          amount: request.amount,
          transportAccountAddress,
          provingBlockNumber: prior.block_number,
          poolFee: 0n,
          warnings: [],
          recovered: true,
        };
      }
      this.transfers.invalidateProofNonceCache();
    }

    const paymasterBuild = await this.paymaster.buildPoolAction(
      this.poolAddress,
      this.usdcAddress,
    );
    const fee = paymasterBuild.feeAction;
    if (fee && BigInt(fee.token) !== BigInt(this.usdcAddress)) {
      throw new Error(
        "private paymaster fee must use the configured USDC token",
      );
    }
    const poolFee = fee?.amount ?? 0n;
    if (poolFee > this.maxPrivatePaymasterFee) {
      throw new Error("private paymaster fee exceeds the configured maximum");
    }
    const required = request.amount + poolFee;

    const currentBlock = await this.provider.getBlockNumber();
    const provingBlockNumber = currentBlock - STRK20_MAINNET.provingDepthBlocks;
    if (provingBlockNumber <= STRK20_MAINNET.noteMaturityBlocks) {
      throw new Error("Starknet head is too young for a mature proof base");
    }
    const { notes } = await this.transfers.discoverNotes({
      tokens: [BigInt(this.usdcAddress)],
      blockIdentifier: provingBlockNumber,
    });
    const selection = selectMatureNotes(
      notes.get(BigInt(this.usdcAddress)) ?? [],
      required,
      provingBlockNumber,
    );

    const builder = this.transfers
      .build({
        autoDiscover: { channels: "refresh" },
        provingBlockId: provingBlockNumber,
      })
      .with(this.usdcAddress, (token) => {
        token.inputs(...selection.selected).withdraw({
          recipient: transportAccountAddress,
          amount: request.amount,
        });
        if (fee && fee.amount > 0n) {
          token.withdraw({ recipient: fee.recipient, amount: fee.amount });
        }
      })
      .surplusTo(this.account.address, false);
    const invocation = await builder.createProofInvocation();
    if (
      invocation.warnings.some(
        (warning) => warning.code === WarningCode.USER_LINKAGE,
      )
    ) {
      throw new Error("STRK20 transport withdrawal stopped on USER_LINKAGE");
    }
    const execution = await this.transfers.executeWithInvocation(
      invocation,
      provingBlockNumber,
    );
    const proof = execution.callAndProof.proof;
    let submitted;
    let relayStarted = false;
    try {
      submitted = await this.paymaster.executePoolAction({
        poolAddress: this.poolAddress,
        call: execution.callAndProof.call,
        proof: proof.data,
        proofFacts: proof.proofFacts ?? [],
        build: paymasterBuild,
        onRelayStart: async () => {
          relayStarted = true;
          await request.onRelayStart?.();
        },
      });
    } catch (error) {
      if (!relayStarted) this.transfers.invalidateProofNonceCache();
      if (relayStarted) {
        throw new Error(
          "STRK20 withdrawal relay outcome is unknown; do not resubmit until reconciled",
          { cause: error },
        );
      }
      throw error;
    }
    await request.onTransactionHash?.(submitted.transactionHash);

    const receipt = await this.provider.waitForTransaction(
      submitted.transactionHash,
    );
    if (!receipt.isSuccess()) {
      throw new Error(
        `STRK20 transport withdrawal reverted: ${submitted.transactionHash}`,
      );
    }
    if (receipt.block_number === undefined) {
      throw new Error(
        "STRK20 transport withdrawal receipt has no block number",
      );
    }
    return {
      transactionHash: submitted.transactionHash,
      blockNumber: receipt.block_number,
      token: this.usdcAddress,
      amount: request.amount,
      transportAccountAddress,
      provingBlockNumber,
      poolFee,
      warnings: execution.warnings,
      recovered: false,
    };
  }
}

export function createUserStrk20Session(
  config: UserStrk20Config,
  identity: DerivedPonsPrivacyIdentity,
): UserStrk20Session {
  if (config.maxPrivatePaymasterFee < 0n) {
    throw new Error("maxPrivatePaymasterFee must not be negative");
  }
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({
    provider,
    address: identity.starknetAddress,
    signer: identity.starknetPrivateKey,
    cairoVersion: "1",
  });
  const ohttp = { publicKeyConfig: config.ohttpPublicKeyConfig };
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => identity.viewingKey },
    provingProvider: new ProvingServiceProofProvider(
      config.provingServiceUrl,
      constants.StarknetChainId.SN_MAIN,
      {
        nodeUrl: config.rpcUrl,
        poolAddress: config.poolAddress,
        ohttp,
        retry: { maxRetries: 3, baseDelayMs: 1_000 },
      },
    ),
    discoveryProvider: new IndexerDiscoveryProvider(
      config.discoveryServiceUrl,
      config.poolAddress,
      { ohttp },
    ),
    poolContractAddress: config.poolAddress,
  });
  return new UserStrk20Session(
    provider,
    account,
    transfers,
    new AvnuPrivatePaymasterGateway(config.privatePaymasterUrl),
    requireStarknetAddress(config.poolAddress, "poolAddress"),
    requireStarknetAddress(config.usdcAddress, "usdcAddress"),
    identity.viewingKey,
    config.maxPrivatePaymasterFee,
  );
}

export function selectMatureNotes(
  notes: readonly Note[],
  amount: bigint,
  provingBlockNumber: number,
): MatureNoteSelection {
  if (amount <= 0n) throw new Error("withdrawal amount must be positive");
  const privateBalance = notes.reduce((sum, note) => sum + note.amount, 0n);
  const maturityCutoff = provingBlockNumber - STRK20_MAINNET.noteMaturityBlocks;
  const mature = notes.filter(
    (note) =>
      typeof note.created === "number" &&
      Number.isSafeInteger(note.created) &&
      note.created <= maturityCutoff,
  );
  const matureBalance = mature.reduce((sum, note) => sum + note.amount, 0n);
  if (matureBalance < amount) {
    throw new Error("insufficient mature STRK20 balance");
  }
  const selected: Note[] = [];
  let selectedAmount = 0n;
  for (const note of mature) {
    selected.push(note);
    selectedAmount += note.amount;
    if (selectedAmount >= amount) break;
  }
  return { selected, selectedAmount, privateBalance, matureBalance };
}

async function waitForSettledProvingBlock(
  provider: Pick<RpcProvider, "getBlockNumber">,
  dependencyBlock: number,
): Promise<number> {
  if (!Number.isSafeInteger(dependencyBlock) || dependencyBlock < 0) {
    throw new Error("proving dependency block must be a non-negative integer");
  }
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    const currentBlock = await provider.getBlockNumber();
    const provingBlock = currentBlock - STRK20_MAINNET.provingDepthBlocks;
    if (provingBlock >= dependencyBlock) return provingBlock;
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for a settled STRK20 proving block");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}
