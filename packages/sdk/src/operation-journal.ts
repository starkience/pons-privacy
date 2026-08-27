const JOURNAL_DOMAIN = "pons-privacy-operation-journal:v1";
const ENVELOPE_VERSION = 1;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const BASE_UNITS_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const STARKNET_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type DepositOperationState =
  | "draft"
  | "quote-ready"
  | "swap-created"
  | "source-submitted"
  | "bridged-to-starknet"
  | "shielding"
  | "private"
  | "refunding"
  | "refunded";

export type ExitOperationState =
  | "draft"
  | "quote-ready"
  | "swap-created"
  | "private-withdrawal-submitted"
  | "transport-funded"
  | "bridge-transfer-submitted"
  | "ready-on-robinhood"
  | "refunding"
  | "refunded";

export type PrivacyOperationState = DepositOperationState | ExitOperationState;

export interface PrivacyOperation {
  readonly id: string;
  readonly direction: "deposit" | "exit";
  readonly state: PrivacyOperationState;
  readonly accountIndex: number;
  /** Six-decimal stablecoin base units, encoded as an unsigned decimal string. */
  readonly amount: string;
  readonly rootStarknetAddress: string;
  readonly transportStarknetAddress?: string;
  readonly robinhoodExecutionAddress?: string;
  readonly swapId?: string;
  readonly sourceTxHash?: string;
  /** Actual destination-chain amount, not the source amount requested. */
  readonly destinationAmount?: string;
  readonly accountDeploymentTxHash?: string;
  /** Set before the private relay request leaves the browser. */
  readonly privateRelayStartedAt?: number;
  readonly privateTxHash?: string;
  readonly transportTxHash?: string;
  readonly destinationTxHash?: string;
  readonly quoteExpiresAt?: number;
  readonly lastError?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface NewPrivacyOperation {
  readonly direction: "deposit" | "exit";
  readonly accountIndex: number;
  readonly amount: bigint;
  readonly rootStarknetAddress: string;
  readonly transportStarknetAddress?: string;
  readonly robinhoodExecutionAddress?: string;
  readonly quoteExpiresAt?: number;
}

export type PrivacyOperationPatch = Partial<
  Pick<
    PrivacyOperation,
    | "swapId"
    | "sourceTxHash"
    | "destinationAmount"
    | "accountDeploymentTxHash"
    | "privateRelayStartedAt"
    | "privateTxHash"
    | "transportTxHash"
    | "destinationTxHash"
    | "quoteExpiresAt"
  >
>;

export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OperationJournalOptions {
  readonly storage?: JournalStorage;
  readonly crypto?: Crypto;
  readonly now?: () => number;
}

interface JournalDocument {
  readonly version: 1;
  readonly operations: readonly PrivacyOperation[];
}

interface EncryptedEnvelope {
  readonly version: 1;
  readonly iv: string;
  readonly ciphertext: string;
}

const DEPOSIT_TRANSITIONS: Record<
  DepositOperationState,
  readonly DepositOperationState[]
> = {
  draft: ["quote-ready"],
  "quote-ready": ["draft", "swap-created"],
  "swap-created": ["source-submitted", "refunding"],
  "source-submitted": ["bridged-to-starknet", "refunding"],
  "bridged-to-starknet": ["shielding"],
  shielding: ["private"],
  private: [],
  refunding: ["refunded"],
  refunded: [],
};

const EXIT_TRANSITIONS: Record<
  ExitOperationState,
  readonly ExitOperationState[]
> = {
  draft: ["quote-ready"],
  "quote-ready": ["draft", "swap-created"],
  "swap-created": ["private-withdrawal-submitted", "refunding"],
  "private-withdrawal-submitted": ["transport-funded"],
  "transport-funded": ["bridge-transfer-submitted", "refunding"],
  "bridge-transfer-submitted": ["ready-on-robinhood", "refunding"],
  "ready-on-robinhood": [],
  refunding: ["refunded"],
  refunded: [],
};

/**
 * Encrypted, resumable workflow storage. The signature is used only to derive
 * an AES key in memory and is never written to storage.
 */
export class PonsOperationJournal {
  private constructor(
    private readonly storage: JournalStorage,
    private readonly cryptoImpl: Crypto,
    private readonly key: CryptoKey,
    private readonly storageKey: string,
    private readonly now: () => number,
  ) {}

  static async open(
    evmSignature: string,
    options: OperationJournalOptions = {},
  ): Promise<PonsOperationJournal> {
    if (!SIGNATURE_PATTERN.test(evmSignature)) {
      throw new Error("evmSignature must be a 65-byte 0x signature");
    }
    const cryptoImpl = options.crypto ?? globalThis.crypto;
    const storage = options.storage ?? globalThis.localStorage;
    if (!cryptoImpl?.subtle || !storage) {
      throw new Error("encrypted operation storage is unavailable");
    }
    const material = new TextEncoder().encode(
      `${evmSignature}:${JOURNAL_DOMAIN}`,
    );
    const digest = new Uint8Array(
      await cryptoImpl.subtle.digest("SHA-256", material),
    );
    const key = await cryptoImpl.subtle.importKey(
      "raw",
      digest,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const fingerprint = Array.from(digest.slice(0, 12), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return new PonsOperationJournal(
      storage,
      cryptoImpl,
      key,
      `${JOURNAL_DOMAIN}:${fingerprint}`,
      options.now ?? Date.now,
    );
  }

  async list(): Promise<readonly PrivacyOperation[]> {
    const document = await this.read();
    return [...document.operations].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  async create(input: NewPrivacyOperation): Promise<PrivacyOperation> {
    validateNewOperation(input);
    const document = await this.read();
    const timestamp = this.now();
    const operation: PrivacyOperation = {
      id: this.cryptoImpl.randomUUID(),
      direction: input.direction,
      state: "draft",
      accountIndex: input.accountIndex,
      amount: input.amount.toString(),
      rootStarknetAddress: normalizeStarknetAddress(input.rootStarknetAddress),
      ...(input.transportStarknetAddress
        ? {
            transportStarknetAddress: normalizeStarknetAddress(
              input.transportStarknetAddress,
            ),
          }
        : {}),
      ...(input.robinhoodExecutionAddress
        ? {
            robinhoodExecutionAddress: normalizeEvmAddress(
              input.robinhoodExecutionAddress,
            ),
          }
        : {}),
      ...(input.quoteExpiresAt !== undefined
        ? { quoteExpiresAt: input.quoteExpiresAt }
        : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.write({
      version: 1,
      operations: [...document.operations, operation],
    });
    return operation;
  }

  async advance(
    id: string,
    nextState: PrivacyOperationState,
    patch: PrivacyOperationPatch = {},
  ): Promise<PrivacyOperation> {
    const document = await this.read();
    const current = requireOperation(document, id);
    if (current.state !== nextState) {
      const allowed =
        current.direction === "deposit"
          ? DEPOSIT_TRANSITIONS[current.state as DepositOperationState]
          : EXIT_TRANSITIONS[current.state as ExitOperationState];
      if (!allowed?.includes(nextState as never)) {
        throw new Error(
          `invalid ${current.direction} transition: ${current.state} -> ${nextState}`,
        );
      }
    }
    validatePatch(patch);
    const { lastError: _lastError, ...stable } = current;
    const updated: PrivacyOperation = {
      ...stable,
      ...patch,
      state: nextState,
      updatedAt: this.now(),
    };
    await this.replace(document, updated);
    return updated;
  }

  async recordError(id: string, error: string): Promise<PrivacyOperation> {
    const message = journalSafeError(error);
    if (!message) throw new Error("operation error must not be empty");
    const document = await this.read();
    const current = requireOperation(document, id);
    const updated: PrivacyOperation = {
      ...current,
      lastError: message,
      updatedAt: this.now(),
    };
    await this.replace(document, updated);
    return updated;
  }

  async clearError(id: string): Promise<PrivacyOperation> {
    const document = await this.read();
    const current = requireOperation(document, id);
    const { lastError: _lastError, ...withoutError } = current;
    const updated: PrivacyOperation = {
      ...withoutError,
      updatedAt: this.now(),
    };
    await this.replace(document, updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const document = await this.read();
    const operations = document.operations.filter(
      (operation) => operation.id !== id,
    );
    if (operations.length === document.operations.length) {
      throw new Error("privacy operation was not found");
    }
    if (operations.length === 0) {
      this.storage.removeItem(this.storageKey);
      return;
    }
    await this.write({ version: 1, operations });
  }

  private async replace(
    document: JournalDocument,
    updated: PrivacyOperation,
  ): Promise<void> {
    await this.write({
      version: 1,
      operations: document.operations.map((operation) =>
        operation.id === updated.id ? updated : operation,
      ),
    });
  }

  private async read(): Promise<JournalDocument> {
    const serialized = this.storage.getItem(this.storageKey);
    if (!serialized) return { version: 1, operations: [] };
    try {
      const envelope = JSON.parse(serialized) as EncryptedEnvelope;
      if (
        envelope.version !== ENVELOPE_VERSION ||
        typeof envelope.iv !== "string" ||
        typeof envelope.ciphertext !== "string"
      ) {
        throw new Error();
      }
      const plaintext = await this.cryptoImpl.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromBase64(envelope.iv),
          additionalData: new TextEncoder().encode(JOURNAL_DOMAIN),
        },
        this.key,
        fromBase64(envelope.ciphertext),
      );
      const document = JSON.parse(
        new TextDecoder().decode(plaintext),
      ) as JournalDocument;
      validateDocument(document);
      return document;
    } catch {
      throw new Error("privacy operation journal could not be decrypted");
    }
  }

  private async write(document: JournalDocument): Promise<void> {
    const iv = this.cryptoImpl.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(document));
    const ciphertext = await this.cryptoImpl.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(JOURNAL_DOMAIN),
      },
      this.key,
      plaintext,
    );
    const envelope: EncryptedEnvelope = {
      version: 1,
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    };
    this.storage.setItem(this.storageKey, JSON.stringify(envelope));
  }
}

function journalSafeError(value: string): string {
  const message = value.trim().replace(/\s+/g, " ").slice(0, 500);
  if (!message) return "";
  // Provider errors can embed signatures, witnesses, proofs, calldata, or
  // request bodies. Keep those visible only in the current in-memory UI error.
  if (
    /0x[0-9a-fA-F]{64,}/.test(message) ||
    /[A-Za-z0-9+/_=-]{96,}/.test(message) ||
    /[{}\[\]]/.test(message)
  ) {
    return "Operation paused; reconnect and resume safely.";
  }
  return message;
}

function requireOperation(
  document: JournalDocument,
  id: string,
): PrivacyOperation {
  const operation = document.operations.find(
    (candidate) => candidate.id === id,
  );
  if (!operation) throw new Error("privacy operation was not found");
  return operation;
}

function validateNewOperation(input: NewPrivacyOperation): void {
  if (!Number.isSafeInteger(input.accountIndex) || input.accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  if (input.amount <= 0n) throw new Error("operation amount must be positive");
  normalizeStarknetAddress(input.rootStarknetAddress);
  if (input.direction === "exit") {
    if (!input.transportStarknetAddress || !input.robinhoodExecutionAddress) {
      throw new Error("exit operations require fresh S2 and R2 addresses");
    }
    if (
      BigInt(input.rootStarknetAddress) ===
      BigInt(input.transportStarknetAddress)
    ) {
      throw new Error(
        "exit transport account must differ from the root account",
      );
    }
  }
  if (input.transportStarknetAddress)
    normalizeStarknetAddress(input.transportStarknetAddress);
  if (input.robinhoodExecutionAddress)
    normalizeEvmAddress(input.robinhoodExecutionAddress);
  if (input.quoteExpiresAt !== undefined)
    validateTimestamp(input.quoteExpiresAt, "quoteExpiresAt");
}

function validatePatch(patch: PrivacyOperationPatch): void {
  for (const field of [
    "swapId",
    "sourceTxHash",
    "accountDeploymentTxHash",
    "privateTxHash",
    "transportTxHash",
    "destinationTxHash",
  ] as const) {
    const value = patch[field];
    if (value !== undefined && (!value.trim() || value.length > 256)) {
      throw new Error(`${field} must be a non-empty bounded string`);
    }
  }
  if (
    patch.destinationAmount !== undefined &&
    (!BASE_UNITS_PATTERN.test(patch.destinationAmount) ||
      patch.destinationAmount === "0")
  ) {
    throw new Error("destinationAmount must be positive base units");
  }
  if (patch.privateRelayStartedAt !== undefined) {
    validateTimestamp(patch.privateRelayStartedAt, "privateRelayStartedAt");
  }
  if (patch.quoteExpiresAt !== undefined)
    validateTimestamp(patch.quoteExpiresAt, "quoteExpiresAt");
}

function validateDocument(value: JournalDocument): void {
  if (value.version !== 1 || !Array.isArray(value.operations))
    throw new Error();
  for (const operation of value.operations) {
    if (
      !operation ||
      typeof operation.id !== "string" ||
      (operation.direction !== "deposit" && operation.direction !== "exit") ||
      !BASE_UNITS_PATTERN.test(operation.amount) ||
      operation.amount === "0" ||
      !Number.isSafeInteger(operation.accountIndex) ||
      operation.accountIndex < 0 ||
      !Number.isSafeInteger(operation.createdAt) ||
      operation.createdAt < 0 ||
      !Number.isSafeInteger(operation.updatedAt) ||
      operation.updatedAt < operation.createdAt ||
      (operation.direction === "deposit"
        ? !Object.hasOwn(DEPOSIT_TRANSITIONS, operation.state)
        : !Object.hasOwn(EXIT_TRANSITIONS, operation.state))
    ) {
      throw new Error();
    }
    normalizeStarknetAddress(operation.rootStarknetAddress);
    if (
      operation.destinationAmount !== undefined &&
      (!BASE_UNITS_PATTERN.test(operation.destinationAmount) ||
        operation.destinationAmount === "0")
    ) {
      throw new Error();
    }
    if (operation.privateRelayStartedAt !== undefined) {
      validateTimestamp(
        operation.privateRelayStartedAt,
        "privateRelayStartedAt",
      );
    }
    if (operation.direction === "exit") {
      if (
        !operation.transportStarknetAddress ||
        !operation.robinhoodExecutionAddress
      ) {
        throw new Error();
      }
      normalizeStarknetAddress(operation.transportStarknetAddress);
      normalizeEvmAddress(operation.robinhoodExecutionAddress);
    }
  }
}

function validateTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
}

function normalizeStarknetAddress(value: string): string {
  if (!STARKNET_ADDRESS_PATTERN.test(value))
    throw new Error("invalid Starknet address");
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= 2n ** 251n)
    throw new Error("invalid Starknet address");
  return `0x${parsed.toString(16)}`;
}

function normalizeEvmAddress(value: string): string {
  if (!EVM_ADDRESS_PATTERN.test(value) || BigInt(value) === 0n) {
    throw new Error("invalid EVM address");
  }
  return value;
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}
