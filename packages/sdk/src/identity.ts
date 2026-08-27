import { ec, hash } from "starknet";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * These labels and the signed message are a permanent derivation contract.
 * Changing a byte derives different accounts and can orphan existing funds.
 * The layout follows starkware-libs/privacy-bridge (Apache-2.0), with a
 * PrivatePons-specific EVM execution-account domain.
 */
export const PONS_PRIVACY_STARKNET_KEY_LABEL = "starknet-account:v1";
export const PONS_PRIVACY_VIEWING_KEY_LABEL = "viewing-key:v1";
export const PONS_PRIVACY_STARKNET_TRANSPORT_LABEL =
  "starknet-transport-account:v1";
export const PONS_PRIVACY_STARKNET_RETURN_LABEL = "starknet-return-account:v1";
export const PONS_PRIVACY_RETURN_VIEWING_KEY_LABEL = "return-viewing-key:v1";
export const PONS_PRIVACY_EVM_ACCOUNT_LABEL = "pons-robinhood-eoa:v1";
export const PONS_PRIVACY_APP_ID = "privatepons.app";

const EVM_SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export interface DerivedPonsPrivacyIdentity {
  /** Memory-only. Never log, persist, send to Pons, or put in analytics. */
  readonly starknetPrivateKey: Hex;
  readonly starknetPublicKey: Hex;
  readonly starknetAddress: Hex;
  /** Read-only note-discovery capability, but still privacy-sensitive. */
  readonly viewingKey: bigint;
}

export interface DerivedRobinhoodExecutionAccount {
  /** Memory-only. Never log, persist, send to Pons, or put in analytics. */
  readonly privateKey: Hex;
  readonly address: Address;
}

export interface DerivedPonsPrivacyRoute {
  readonly rootIdentity: DerivedPonsPrivacyIdentity;
  readonly transportIdentity: DerivedPonsPrivacyIdentity;
  /** Fresh sell-return account with a distinct public viewing key from S1. */
  readonly returnIdentity: DerivedPonsPrivacyIdentity;
  readonly robinhoodExecution: DerivedRobinhoodExecutionAccount;
}

/** A route whose deployed factory has resolved the counterfactual Pons account. */
export interface ResolvedPonsPrivacyRoute extends DerivedPonsPrivacyRoute {
  /** Fund this account, not the derived owner EOA. */
  readonly robinhoodExecutionAccount: Address;
}

export function createPonsPrivacyIdentityMessage(appId: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(appId)) {
    throw new Error(
      "appId must be a lowercase DNS-style slug of at most 63 characters",
    );
  }
  return [
    "Pons Privacy — derive sanitization keys",
    "Version: 1",
    `Application: ${appId}`,
    "",
    "This signature does not authorize a blockchain transaction or transfer.",
  ].join("\n");
}

export const PONS_PRIVACY_IDENTITY_MESSAGE =
  createPonsPrivacyIdentityMessage(PONS_PRIVACY_APP_ID);

export function derivePonsPrivacyIdentity(
  evmSignature: string,
  ozAccountClassHash: string,
): DerivedPonsPrivacyIdentity {
  assertEvmSignature(evmSignature);
  const classHash = requireHexFelt(ozAccountClassHash, "ozAccountClassHash");
  return deriveStarknetIdentity(
    evmSignature,
    classHash,
    PONS_PRIVACY_STARKNET_KEY_LABEL,
    deriveViewingKey(evmSignature),
  );
}

/**
 * Fresh, per-operation Starknet account used only for the public LayerSwap
 * source leg. It is funded from STRK20 after mixing, so the public/root-linked
 * Starknet account never initiates the outbound bridge. Refunds remain
 * recoverable by the same EVM root signature.
 */
export function deriveStarknetTransportAccount(
  evmSignature: string,
  accountIndex: number,
  ozAccountClassHash: string,
): DerivedPonsPrivacyIdentity {
  assertEvmSignature(evmSignature);
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  const classHash = requireHexFelt(ozAccountClassHash, "ozAccountClassHash");
  return deriveStarknetIdentity(
    evmSignature,
    classHash,
    `${PONS_PRIVACY_STARKNET_TRANSPORT_LABEL}:${accountIndex}`,
    deriveViewingKey(evmSignature),
  );
}

/**
 * Fresh, per-position Starknet account used only to receive sold USDG after
 * LayerSwap converts it to USDC. Its viewing key is also scoped per position;
 * reusing S1's public viewing key here would link the two registrations.
 */
export function deriveStarknetReturnAccount(
  evmSignature: string,
  accountIndex: number,
  ozAccountClassHash: string,
): DerivedPonsPrivacyIdentity {
  assertEvmSignature(evmSignature);
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  const classHash = requireHexFelt(ozAccountClassHash, "ozAccountClassHash");
  return deriveStarknetIdentity(
    evmSignature,
    classHash,
    `${PONS_PRIVACY_STARKNET_RETURN_LABEL}:${accountIndex}`,
    deriveViewingKey(
      evmSignature,
      `${PONS_PRIVACY_RETURN_VIEWING_KEY_LABEL}:${accountIndex}`,
    ),
  );
}

export function derivePonsPrivacyRoute(
  evmSignature: string,
  accountIndex: number,
  ozAccountClassHash: string,
): DerivedPonsPrivacyRoute {
  return {
    rootIdentity: derivePonsPrivacyIdentity(evmSignature, ozAccountClassHash),
    transportIdentity: deriveStarknetTransportAccount(
      evmSignature,
      accountIndex,
      ozAccountClassHash,
    ),
    returnIdentity: deriveStarknetReturnAccount(
      evmSignature,
      accountIndex,
      ozAccountClassHash,
    ),
    robinhoodExecution: deriveRobinhoodExecutionAccount(
      evmSignature,
      accountIndex,
    ),
  };
}

function deriveStarknetIdentity(
  evmSignature: string,
  classHash: Hex,
  label: string,
  viewingKey: bigint,
): DerivedPonsPrivacyIdentity {
  const seed = hash.starknetKeccak(`${evmSignature}:${label}`);
  const ground = ec.starkCurve.grindKey(`0x${seed.toString(16)}`);
  const privateScalar = BigInt(`0x${ground.replace(/^0x/, "")}`);
  const starknetPrivateKey = `0x${privateScalar
    .toString(16)
    .padStart(64, "0")}` as Hex;
  const starknetPublicKey = ec.starkCurve.getStarkKey(
    starknetPrivateKey,
  ) as Hex;
  const starknetAddress = hash.calculateContractAddressFromHash(
    starknetPublicKey,
    classHash,
    [starknetPublicKey],
    0,
  ) as Hex;

  return {
    starknetPrivateKey,
    starknetPublicKey,
    starknetAddress,
    viewingKey,
  };
}

export function deriveRobinhoodExecutionAccount(
  evmSignature: string,
  accountIndex: number,
): DerivedRobinhoodExecutionAccount {
  assertEvmSignature(evmSignature);
  if (!Number.isSafeInteger(accountIndex) || accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative safe integer");
  }
  const digest = keccak256(
    stringToHex(
      `${evmSignature}:${PONS_PRIVACY_EVM_ACCOUNT_LABEL}:${accountIndex}`,
    ),
  );
  const reduced = BigInt(digest) % SECP256K1_ORDER;
  const scalar = reduced === 0n ? 1n : reduced;
  const privateKey = `0x${scalar.toString(16).padStart(64, "0")}` as Hex;
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

function deriveViewingKey(
  evmSignature: string,
  label = PONS_PRIVACY_VIEWING_KEY_LABEL,
): bigint {
  const base = `${evmSignature}:${label}`;
  const lo = BigInt(hash.starknetKeccak(`${base}:0`));
  const hi = BigInt(hash.starknetKeccak(`${base}:1`));
  const order = ec.starkCurve.CURVE.n;
  const reduced = ((hi << 250n) | lo) % order;
  const max = order / 2n;
  let canonical = reduced < max ? reduced : order - reduced;
  if (canonical >= max) canonical = max - 1n;
  return canonical === 0n ? 1n : canonical;
}

function assertEvmSignature(signature: string): asserts signature is Hex {
  if (!EVM_SIGNATURE_PATTERN.test(signature)) {
    throw new Error("evmSignature must be a 65-byte 0x signature");
  }
}

function requireHexFelt(value: string, field: string): Hex {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    throw new Error(`${field} must be a Starknet hex felt`);
  }
  const parsed = BigInt(value);
  if (parsed === 0n || parsed >= ec.starkCurve.CURVE.Fp.ORDER) {
    throw new Error(`${field} is outside the Starknet felt range`);
  }
  return value as Hex;
}
