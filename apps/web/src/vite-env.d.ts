/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PONS_PRIVACY_API_URL?: string;
  readonly VITE_API_MODE?: "demo" | "live";
  readonly VITE_MAINNET_LAUNCH_ENABLED?: string;
  readonly VITE_MAINNET_PRIVACY_EXECUTION_ENABLED?: string;
  readonly VITE_DEPOSIT_API_URL?: string;
  readonly VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET?: string;
  readonly VITE_STARKNET_RPC_URL?: string;
  readonly VITE_PRIVATE_PAYMASTER_URL?: string;
  readonly VITE_STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
