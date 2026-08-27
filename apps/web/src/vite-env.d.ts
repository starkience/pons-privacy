/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PONS_PRIVACY_API_URL?: string;
  readonly VITE_API_MODE?: "demo" | "live";
  readonly VITE_MAINNET_LAUNCH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
