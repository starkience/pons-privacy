import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      "/layerswap-api": {
        target: "https://api.layerswap.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/layerswap-api/, ""),
      },
    },
  },
  preview: { port: 4173 },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    css: true,
  },
});
