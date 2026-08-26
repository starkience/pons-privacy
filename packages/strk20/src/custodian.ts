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
import {
  requireStarknetAddress,
  type Strk20CustodianConfig,
} from "./config.js";
import { STRK20_MAINNET_RC4 } from "./constants.js";

export interface Strk20WithdrawalRequest {
  readonly amount: bigint;
  readonly recipient: string;
  readonly allowUserLinkageWarning: boolean;
}

export interface Strk20WithdrawalResult {
  readonly transactionHash: string;
  readonly blockNumber: number;
  readonly token: string;
  readonly amount: bigint;
  readonly recipient: string;
  readonly provingBlockNumber: number;
  readonly warnings: readonly Warning[];
}

export interface MatureNoteSelection {
  readonly selected: readonly Note[];
  readonly selectedAmount: bigint;
  readonly privateBalance: bigint;
  readonly matureBalance: bigint;
}

export class Strk20Custodian {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly provider: RpcProvider,
    private readonly account: Account,
    private readonly transfers: PrivateTransfersInterface,
    private readonly usdcAddress: string,
  ) {}

  withdraw(request: Strk20WithdrawalRequest): Promise<Strk20WithdrawalResult> {
    const result = this.queue.then(() => this.withdrawExclusive(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async withdrawExclusive(
    request: Strk20WithdrawalRequest,
  ): Promise<Strk20WithdrawalResult> {
    if (request.amount <= 0n) {
      throw new Error("STRK20 withdrawal amount must be positive");
    }
    const recipient = requireStarknetAddress(
      request.recipient,
      "STRK20 withdrawal recipient",
    );
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
      request.amount,
      provingBlockNumber,
    );

    const builder = this.transfers
      .build({
        autoDiscover: { channels: "refresh" },
        provingBlockId: provingBlockNumber,
      })
      .with(this.usdcAddress, (token) =>
        token
          .inputs(...selection.selected)
          .withdraw({ recipient, amount: request.amount }),
      )
      .surplusTo(this.account.address, false);
    const invocation = await builder.createProofInvocation();

    if (
      invocation.warnings.some(
        (warning) => warning.code === WarningCode.USER_LINKAGE,
      ) &&
      !request.allowUserLinkageWarning
    ) {
      throw new Error("STRK20 withdrawal stopped on USER_LINKAGE warning");
    }
    const execution = await this.transfers.executeWithInvocation(
      invocation,
      provingBlockNumber,
    );

    let transactionHash: string;
    try {
      const response = await this.account.execute(execution.callAndProof.call, {
        tip: 0n,
        proofFacts: execution.callAndProof.proof.proofFacts,
        proof: execution.callAndProof.proof.data,
      });
      transactionHash = response.transaction_hash;
    } catch {
      this.transfers.invalidateProofNonceCache();
      throw new Error("STRK20 withdrawal submission failed");
    }

    const receipt = await this.provider.waitForTransaction(transactionHash);
    if (!receipt.isSuccess()) {
      throw new Error(`STRK20 withdrawal reverted: ${transactionHash}`);
    }
    if (receipt.block_number === undefined) {
      throw new Error("STRK20 withdrawal receipt has no block number");
    }
    return {
      transactionHash,
      blockNumber: receipt.block_number,
      token: this.usdcAddress,
      amount: request.amount,
      recipient,
      provingBlockNumber,
      warnings: execution.warnings,
    };
  }
}

export function createStrk20Custodian(
  config: Strk20CustodianConfig,
): Strk20Custodian {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const account = new Account({
    provider,
    address: config.accountAddress,
    signer: config.accountPrivateKey,
    cairoVersion: "1",
  });
  const ohttp = { publicKeyConfig: config.ohttpPublicKeyConfig };
  const provingProvider = new ProvingServiceProofProvider(
    config.provingServiceUrl,
    constants.StarknetChainId.SN_MAIN,
    {
      nodeUrl: config.rpcUrl,
      poolAddress: config.poolAddress,
      ohttp,
      retry: { maxRetries: 3, baseDelayMs: 1_000 },
    },
  );
  const discoveryProvider = new IndexerDiscoveryProvider(
    config.discoveryServiceUrl,
    config.poolAddress,
    { ohttp },
  );
  const transfers = createPrivateTransfers({
    account,
    viewingKeyProvider: { getViewingKey: async () => config.viewingKey },
    provingProvider,
    discoveryProvider,
    poolContractAddress: config.poolAddress,
  });
  return new Strk20Custodian(provider, account, transfers, config.usdcAddress);
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
