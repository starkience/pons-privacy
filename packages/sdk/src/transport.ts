import type { Address, Hash } from "viem";

export type TransportNetwork = "STARKNET_MAINNET" | "ROBINHOOD_MAINNET";
export type TransportAsset = "USDC" | "USDG";
export type TransportDirection = "fund-robinhood" | "return-to-strk20";

export interface StableTransportQuote {
  provider: "layerswap" | "rhinofi";
  direction: TransportDirection;
  sourceNetwork: TransportNetwork;
  sourceAsset: TransportAsset;
  destinationNetwork: TransportNetwork;
  destinationAsset: TransportAsset;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  expiresAt: number;
  feeAmount: bigint;
}

export interface StableTransportOrder extends StableTransportQuote {
  id: string;
  destination: string;
  refundAddress: string;
  depositAction: unknown;
}

export type StableTransportStatus =
  | { state: "created" | "awaiting-deposit"; order: StableTransportOrder }
  | { state: "source-confirmed"; order: StableTransportOrder; sourceTx: Hash }
  | {
      state: "delivered";
      order: StableTransportOrder;
      sourceTx: Hash;
      destinationTx: string;
      amountOut: bigint;
    }
  | { state: "refunding"; order: StableTransportOrder; sourceTx: Hash }
  | { state: "refunded"; order: StableTransportOrder; refundTx: string }
  | { state: "manual-review"; order: StableTransportOrder; reason: string };

export interface StableTransport {
  quote(args: {
    direction: TransportDirection;
    amountIn: bigint;
    destination: string;
    refundAddress: string;
  }): Promise<StableTransportQuote>;
  createOrder(args: {
    quote: StableTransportQuote;
    destination: string;
    refundAddress: string;
  }): Promise<StableTransportOrder>;
  status(orderId: string): Promise<StableTransportStatus>;
}

export interface Strk20SanitizationBoundary {
  /** Authenticated pool withdrawal to a narrowly validated transport action. */
  withdrawUsdcToTransport(args: {
    identitySignature: string;
    order: StableTransportOrder;
  }): Promise<{ sourceTransaction: string }>;

  /** Open a new note only after independently verifying USDC delivery. */
  openRecoveredUsdcNote(args: {
    identitySignature: string;
    recoveryAccount: string;
    deliveredAmount: bigint;
    destinationTransaction: string;
  }): Promise<{ noteTransaction: string }>;
}

export interface RobinhoodFundingDestination {
  account: Address;
}
