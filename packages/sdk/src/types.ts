import type { Address, Hash, Hex, PublicClient } from "viem";

export interface ExecutionCall {
  target: Address;
  value: bigint;
  data: Hex;
}

export interface RelayerFee {
  token: Address;
  amount: bigint;
  recipient: Address;
}

export interface RelayExecutionRequest {
  chainId: number;
  factory: Address;
  account: Address;
  owner: Address;
  accountIndex: number;
  calls: readonly ExecutionCall[];
  nonce: bigint;
  deadline: bigint;
  prefund: bigint;
  fee: RelayerFee;
  signature: Hex;
  /** Server-verified metadata; signed calls remain the authorization boundary. */
  policyContext?: RelayPolicyContext;
}

export interface RelayPolicyContext {
  readonly kind: "layerswap-return";
  readonly swapId: string;
}

export type RelayExecution = (request: RelayExecutionRequest) => Promise<Hash>;

export interface AdapterContext {
  account: Address;
  publicClient: PublicClient;
}

export interface LaunchpadAdapter<TOpenIntent, TCloseIntent = TOpenIntent> {
  readonly id: string;
  readonly chainId: number;
  buildOpenCalls(
    intent: TOpenIntent,
    context: AdapterContext,
  ): Promise<readonly ExecutionCall[]>;
  buildCloseCalls(
    intent: TCloseIntent,
    context: AdapterContext,
  ): Promise<readonly ExecutionCall[]>;
}

export interface PonsPrivacySession {
  accountIndex: number;
  channel: string;
  owner: Address;
  account: Address;
}

export interface DerivedExecutionOwner {
  privateKey: Hex;
  address: Address;
}

/** Implement this with the official STRK20 SDK/shadow-account derivation route. */
export interface ExecutionOwnerDeriver {
  deriveEvmOwner(
    identitySignature: string,
    accountIndex: number,
    channel: string,
  ): DerivedExecutionOwner;
}

export interface ExecuteOptions {
  fee?: RelayerFee;
  prefund?: bigint;
  deadlineSeconds?: number;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const NO_RELAYER_FEE: RelayerFee = {
  token: ZERO_ADDRESS,
  amount: 0n,
  recipient: ZERO_ADDRESS,
};
