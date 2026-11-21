import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { e2eCoverage } from "../scripts/vite-coverage";

/**
 * The cloud SPA. Built straight into the Python app (`apps/cloud/dist`), which the
 * FastAPI service serves at the site root — so `yarn build` is all an update needs.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react(), e2eCoverage()],
  base: "/",
  resolve: { alias: { "@shared": resolve(__dirname, "../shared") } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: resolve(__dirname, "../../apps/cloud/dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
