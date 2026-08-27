import "@fontsource-variable/bricolage-grotesque";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createDemoLaunchApi, createLaunchApi } from "./launch-api.js";
import "./styles.css";

const apiMode = import.meta.env.VITE_API_MODE === "live" ? "live" : "demo";
const api =
  apiMode === "live"
    ? createLaunchApi(import.meta.env.VITE_PONS_PRIVACY_API_URL ?? "/api")
    : createDemoLaunchApi();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App
      api={api}
      apiMode={apiMode}
      launchEnabled={import.meta.env.VITE_MAINNET_LAUNCH_ENABLED === "true"}
    />
  </StrictMode>,
);
