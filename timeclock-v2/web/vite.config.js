import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { "@shared": path.resolve(here, "../shared") } },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(here, "..")] },
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: false } },
  },
  build: { outDir: path.resolve(here, "dist"), emptyOutDir: true },
});
