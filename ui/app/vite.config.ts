import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import { e2eCoverage } from "../scripts/vite-coverage";

/**
 * The web app at `/app/`: a signed-in person views and edits their cloud items — their
 * tasks — in the screens wysebee-desktop has for them. Built straight
 * into the Python app (`apps/cloud/dist/app`), after the landing page (whose build empties
 * `apps/cloud/dist`). wysebee-cloud serves it with its own CSP header (apps/cloud/main.py).
 *
 * The admin API the screens call is answered in the browser (src/cloud/: router.ts,
 * routes.ts) from wysebee-cloud's `/api/v1/configs`.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react(), e2eCoverage()],
  base: "/app/",
  resolve: { alias: { "@shared": resolve(__dirname, "../shared") } },
  css: { postcss: { plugins: [tailwindcss()] } },
  build: {
    outDir: resolve(__dirname, "../../apps/cloud/dist/app"),
    emptyOutDir: true,
  },
  server: {
    // `yarn dev:app`: http://localhost:5174/app/ against wysebee-cloud on :8000.
    port: 5174,
    // …and a page shared publicly, at its own address (apps/cloud/workspace_pages.py).
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true }, "/s/": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
