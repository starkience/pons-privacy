import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createDepositQuoteApi } from "./deposit-api.js";
import { createDemoLaunchApi, createLaunchApi } from "./launch-api.js";
import {
  createPrivacyExecutionRunner,
  parsePrivatePaymasterFeeCap,
} from "./privacy-execution.js";
import "./styles.css";

const apiMode = import.meta.env.VITE_API_MODE === "live" ? "live" : "demo";
const api =
  apiMode === "live"
    ? createLaunchApi(import.meta.env.VITE_PONS_PRIVACY_API_URL ?? "/api")
    : createDemoLaunchApi();
const depositApi = createDepositQuoteApi(
  import.meta.env.VITE_DEPOSIT_API_URL ?? "/deposit-api/v1",
);
const privacyExecutionRequested =
  import.meta.env.VITE_MAINNET_PRIVACY_EXECUTION_ENABLED === "true";
const privacyExecutionRunner =
  privacyExecutionRequested &&
  import.meta.env.VITE_STARKNET_RPC_URL &&
  import.meta.env.VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET &&
  import.meta.env.VITE_STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC !== undefined
    ? createPrivacyExecutionRunner({
        rpcUrl: import.meta.env.VITE_STARKNET_RPC_URL,
        paymasterUrl:
          import.meta.env.VITE_PRIVATE_PAYMASTER_URL ??
          "/deposit-api/v1/paymaster",
        ozAccountClassHash: import.meta.env.VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET,
        maxPrivatePaymasterFee: parsePrivatePaymasterFeeCap(
          import.meta.env.VITE_STRK20_MAX_PRIVATE_PAYMASTER_FEE_USDC,
        ),
      })
    : undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      api={api}
      depositApi={depositApi}
      apiMode={apiMode}
      launchEnabled={import.meta.env.VITE_MAINNET_LAUNCH_ENABLED === "true"}
      mainnetPrivacyExecutionEnabled={Boolean(privacyExecutionRunner)}
      {...(privacyExecutionRunner ? { privacyExecutionRunner } : {})}
      ozAccountClassHash={import.meta.env.VITE_OZ_ACCOUNT_CLASS_HASH_MAINNET}
    />
  </StrictMode>,
);
