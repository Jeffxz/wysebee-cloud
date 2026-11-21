import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The web app's tests (`app/src`, `shared/`). jsdom stands in for the page; `fetch` and
 * the sign-in are mocked at the edges by each test (test/ holds the helpers).
 *
 * `yarn test --coverage` fails below 100% on lines, branches, functions and statements.
 * The landing page (`cloud/`) has a few tests of its own, and is not counted.
 */
/**
 * Node 25 and later have a `localStorage` and `sessionStorage` of their own (Web Storage, on by
 * default), which without `--localstorage-file` read as undefined — and vitest 2 leaves Node's
 * globals in place of jsdom's, so every test's `localStorage.clear()` threw. The test workers
 * run with Node's turned off, where the flag exists (Node 22.4 and later), so jsdom's are used.
 */
const NODE_STORAGE_OFF = process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage") ? ["--no-experimental-webstorage"] : [];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@shared": resolve(__dirname, "shared") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["app/src/**/*.test.{ts,tsx}", "shared/**/*.test.{ts,tsx}", "cloud/src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    poolOptions: { forks: { execArgv: NODE_STORAGE_OFF } },
    coverage: {
      provider: "v8",
      include: ["app/src/**/*.{ts,tsx}", "shared/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        // The entry point only signs in and mounts React into #root; App is tested.
        "app/src/main.tsx",
      ],
      reporter: ["text", "html"],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
