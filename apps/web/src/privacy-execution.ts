import type {
  DerivedPonsPrivacyRoute,
  LayerswapFundingAction,
} from "@pons-privacy/sdk";

export interface PrivacyExecutionRunner {
  quotePrivateFee(): Promise<bigint>;
  shieldDeposit(
    route: DerivedPonsPrivacyRoute,
    request: PrivacyShieldRequest,
  ): Promise<string>;
  withdrawToTransport(
    route: DerivedPonsPrivacyRoute,
    amount: bigint,
  ): Promise<string>;
  submitFundingAction(
    route: DerivedPonsPrivacyRoute,
    action: LayerswapFundingAction,
  ): Promise<string>;
}

export interface PrivacyShieldRequest {
  readonly amount: bigint;
  readonly fundingTransactionHash: string;
  readonly previousDeploymentTransactionHash?: string;
  readonly previousPrivateTransactionHash?: string;
  readonly onDeploymentTransactionHash?: (hash: string) => void | Promise<void>;
  readonly onPrivateRelayStart?: () => void | Promise<void>;
  readonly onPrivateTransactionHash?: (hash: string) => void | Promise<void>;
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
    async quotePrivateFee() {
      const { AvnuPrivatePaymasterGateway, STRK20_MAINNET } =
        await import("@pons-privacy/strk20/browser");
      const build = await new AvnuPrivatePaymasterGateway(
        config.paymasterUrl,
      ).buildPoolAction(STRK20_MAINNET.poolAddress, STRK20_MAINNET.usdcAddress);
      const fee = build.feeAction;
      if (!fee || BigInt(fee.token) !== BigInt(STRK20_MAINNET.usdcAddress)) {
        throw new Error("AVNU did not quote the pinned USDC private fee");
      }
      if (fee.amount > config.maxPrivatePaymasterFee) {
        throw new Error(
          "STRK20 private paymaster fee exceeds the configured cap",
        );
      }
      return fee.amount;
    },
    async shieldDeposit(route, request) {
      const {
        STRK20_MAINNET,
        createRootAccountDeployer,
        createUserStrk20Session,
      } = await import("@pons-privacy/strk20/browser");
      const deployment = await createRootAccountDeployer(
        {
          rpcUrl: config.rpcUrl,
          paymasterUrl: config.paymasterUrl,
          ozAccountClassHash: config.ozAccountClassHash,
        },
        route.rootIdentity,
      ).ensureDeployed({
        ...(request.previousDeploymentTransactionHash
          ? {
              previousTransactionHash:
                request.previousDeploymentTransactionHash,
            }
          : {}),
        ...(request.onDeploymentTransactionHash
          ? { onTransactionHash: request.onDeploymentTransactionHash }
          : {}),
      });
      const session = createUserStrk20Session(
        {
          rpcUrl: config.rpcUrl,
          poolAddress: STRK20_MAINNET.poolAddress,
          poolClassHash: STRK20_MAINNET.poolClassHash,
          provingServiceUrl: STRK20_MAINNET.provingServiceUrl,
          discoveryServiceUrl: STRK20_MAINNET.discoveryServiceUrl,
          ohttpPublicKeyConfig: decodeBase64(
            STRK20_MAINNET.ohttpPublicKeyConfigBase64,
          ),
          usdcAddress: STRK20_MAINNET.usdcAddress,
          privatePaymasterUrl: config.paymasterUrl,
          maxPrivatePaymasterFee: config.maxPrivatePaymasterFee,
        },
        route.rootIdentity,
      );
      const result = await session.depositFromPublicBalance({
        amount: request.amount,
        fundingTransactionHash: request.fundingTransactionHash,
        ...(deployment.blockNumber !== undefined
          ? { deploymentBlockNumber: deployment.blockNumber }
          : {}),
        ...(request.previousPrivateTransactionHash
          ? { previousTransactionHash: request.previousPrivateTransactionHash }
          : {}),
        ...(request.onPrivateRelayStart
          ? { onRelayStart: request.onPrivateRelayStart }
          : {}),
        ...(request.onPrivateTransactionHash
          ? { onTransactionHash: request.onPrivateTransactionHash }
          : {}),
      });
      return result.transactionHash;
    },
    async withdrawToTransport(route, amount) {
      const { STRK20_MAINNET, createUserStrk20Session } =
        await import("@pons-privacy/strk20/browser");
      const session = createUserStrk20Session(
        {
          rpcUrl: config.rpcUrl,
          poolAddress: STRK20_MAINNET.poolAddress,
          poolClassHash: STRK20_MAINNET.poolClassHash,
          provingServiceUrl: STRK20_MAINNET.provingServiceUrl,
          discoveryServiceUrl: STRK20_MAINNET.discoveryServiceUrl,
          ohttpPublicKeyConfig: decodeBase64(
            STRK20_MAINNET.ohttpPublicKeyConfigBase64,
          ),
          usdcAddress: STRK20_MAINNET.usdcAddress,
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
