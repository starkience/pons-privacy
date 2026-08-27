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
import { Account, RpcProvider, constants } from "starknet";
import { requireStarknetAddress, type Strk20NetworkConfig } from "./config.js";
import { STRK20_MAINNET_RC4 } from "./constants.js";
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
    const provingBlockNumber =
      currentBlock - STRK20_MAINNET_RC4.provingDepthBlocks;
    if (provingBlockNumber <= STRK20_MAINNET_RC4.noteMaturityBlocks) {
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
    try {
      submitted = await this.paymaster.executePoolAction({
        poolAddress: this.poolAddress,
        call: execution.callAndProof.call,
        proof: proof.data,
        proofFacts: proof.proofFacts ?? [],
        build: paymasterBuild,
      });
    } catch {
      this.transfers.invalidateProofNonceCache();
      throw new Error("STRK20 private-paymaster submission failed");
    }

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
  const maturityCutoff =
    provingBlockNumber - STRK20_MAINNET_RC4.noteMaturityBlocks;
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
