import { defineConfig } from "vite";

export default defineConfig({
  // Tanpa inlining aset: CSP server hanya mengizinkan font dari origin sendiri (bukan data:).
  build: { outDir: "dist", sourcemap: false, target: "es2020", assetsInlineLimit: 0 },
  server: { proxy: { "/ws": { target: "ws://localhost:8787", ws: true } } },
});
