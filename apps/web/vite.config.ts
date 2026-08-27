import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4173,
    proxy: {
      "/deposit-api": {
        target: "http://127.0.0.1:8788",
        rewrite: (path) => path.replace(/^\/deposit-api/, ""),
      },
      "/api": {
        target: "http://127.0.0.1:8789",
        rewrite: (path) => path.replace(/^\/api/, ""),
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
