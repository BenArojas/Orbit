import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: [
      {
        find: "@vendor/lightweight-charts-drawing",
        replacement: path.resolve(
          __dirname,
          "./vendor/lightweight-charts-drawing/src/index.ts",
        ),
      },
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      { find: "@vendor", replacement: path.resolve(__dirname, "./vendor") },
    ],
  },
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
