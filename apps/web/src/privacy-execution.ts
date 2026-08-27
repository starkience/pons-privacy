import type {
  DerivedPonsPrivacyRoute,
  LayerswapFundingAction,
} from "@pons-privacy/sdk";
const STARKNET_USDC =
  "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";

export interface PrivacyExecutionRunner {
  withdrawToTransport(
    route: DerivedPonsPrivacyRoute,
    amount: bigint,
  ): Promise<string>;
  submitFundingAction(
    route: DerivedPonsPrivacyRoute,
    action: LayerswapFundingAction,
  ): Promise<string>;
}

export interface PrivacyExecutionConfig {
  readonly rpcUrl: string;
  readonly paymasterUrl: string;
  readonly ozAccountClassHash: string;
  readonly maxPrivatePaymasterFee: bigint;
}

export function createPrivacyExecutionRunner(
  config: PrivacyExecutionConfig,
): PrivacyExecutionRunner {
  if (!config.rpcUrl.startsWith("https://") && !config.rpcUrl.startsWith("/")) {
    throw new Error("Starknet RPC URL must be relative or use HTTPS");
  }
  if (
    !config.paymasterUrl.startsWith("https://") &&
    !config.paymasterUrl.startsWith("/")
  ) {
    throw new Error("AVNU paymaster URL must be relative or use HTTPS");
  }
  if (config.maxPrivatePaymasterFee < 0n) {
    throw new Error("STRK20 private paymaster fee cap must not be negative");
  }
  return {
    async withdrawToTransport(route, amount) {
      const { STRK20_MAINNET_RC4, createUserStrk20Session } =
        await import("@pons-privacy/strk20/browser");
      const session = createUserStrk20Session(
        {
          rpcUrl: config.rpcUrl,
          poolAddress: STRK20_MAINNET_RC4.poolAddress,
          poolClassHash: STRK20_MAINNET_RC4.poolClassHash,
          provingServiceUrl: STRK20_MAINNET_RC4.provingServiceUrl,
          discoveryServiceUrl: STRK20_MAINNET_RC4.discoveryServiceUrl,
          ohttpPublicKeyConfig: decodeBase64(
            STRK20_MAINNET_RC4.ohttpPublicKeyConfigBase64,
          ),
          usdcAddress: STARKNET_USDC,
          privatePaymasterUrl: config.paymasterUrl,
          maxPrivatePaymasterFee: config.maxPrivatePaymasterFee,
        },
        route.rootIdentity,
      );
      const result = await session.withdrawToTransport({
        amount,
        transportAccountAddress: route.transportIdentity.starknetAddress,
      });
      return result.transactionHash;
    },
    async submitFundingAction(route, action) {
      const { createTransportAccountExecutor } =
        await import("@pons-privacy/strk20/browser");
      const executor = createTransportAccountExecutor(
        {
          rpcUrl: config.rpcUrl,
          paymasterUrl: config.paymasterUrl,
          ozAccountClassHash: config.ozAccountClassHash,
        },
        route.transportIdentity,
      );
      const result = await executor.executeFundingAction(action);
      return result.transactionHash;
    },
  };
}

export function parsePrivatePaymasterFeeCap(value: string | undefined): bigint {
  if (value === undefined) {
    throw new Error("VITE_STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC is required");
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("Private paymaster fee cap must be USDC base units");
  }
  return BigInt(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}
