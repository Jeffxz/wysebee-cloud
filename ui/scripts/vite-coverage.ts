import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import { loadEnv, type Plugin, type PluginOption } from "vite";
import istanbul from "vite-plugin-istanbul";

/**
 * Coverage of the UI while it is driven from outside — by the Wysebee browser extension's
 * agent, or a person clicking through — rather than by `yarn test`.
 *
 * Off unless the dev server is started with `WYSEBEE_E2E_COVERAGE=1` (`yarn dev:coverage`,
 * `yarn dev:app:coverage`); a normal `yarn dev` or `yarn build` is untouched. When on:
 *
 * - vite-plugin-istanbul instruments app/src, shared and cloud/src, so the page counts what
 *   runs in `window.__coverage__`.
 * - The page saves that count to the dev server (`POST <base>__coverage__`) every few
 *   seconds, when it is hidden or left, and whenever `await window.__saveCoverage__()` is
 *   called — which a scenario should do last, so its final clicks are counted.
 * - The dev server writes it to ui/.nyc_output/<scenario>/<page load>.json. The scenario is
 *   `localStorage["wysebee-coverage-scenario"]` (set it, then reload), or "default".
 *   Each page load has its own file, overwritten by its later saves — and moved, if the
 *   scenario was changed since — so nothing is counted twice.
 *
 * `yarn coverage:report` merges the files into ui/coverage-e2e/ (scripts/coverage-report.mjs).
 *
 * Behind ngrok (`WEB_PORT=5174 ./scripts/ngrok.sh`, signing in with Auth0 at CLOUD_PUBLIC_URL):
 * the server answers the tunnel's host, and the web app's server forwards everything outside
 * `/app/` (the landing page, `/api`, `/auth/callback`) to wysebee-cloud on :8000, so the
 * public URL works as it does when the tunnel goes to :8000 — with `/app/` measured. Hot
 * reload is off: a reload would start the page's count again.
 */

const UI_DIR = resolve(__dirname, "..");
const REPO_DIR = resolve(UI_DIR, "..");
const CLOUD = "http://localhost:8000";
export const COVERAGE_DIR = resolve(UI_DIR, ".nyc_output");
const ENDPOINT = "__coverage__";

export function e2eCoverage(): PluginOption[] {
  if (process.env.WYSEBEE_E2E_COVERAGE !== "1") return [];
  return [
    istanbul({
      cwd: UI_DIR,
      include: ["app/src/**", "shared/**", "cloud/src/**"],
      exclude: ["node_modules/**", "**/*.test.{ts,tsx}", "**/*.d.ts"],
      extension: [".ts", ".tsx"],
      requireEnv: false,
    }),
    coverageCollector(),
    behindTunnel(),
  ];
}

function behindTunnel(): Plugin {
  return {
    name: "wysebee-e2e-coverage-tunnel",
    apply: "serve",
    config(config, { mode }) {
      const url = process.env.CLOUD_PUBLIC_URL || loadEnv(mode, REPO_DIR, "CLOUD_PUBLIC_URL").CLOUD_PUBLIC_URL;
      const tunnelHost = url ? new URL(url).hostname : undefined;
      return {
        server: {
          allowedHosts: [...(tunnelHost ? [tunnelHost] : []), ".ngrok.dev", ".ngrok.app", ".ngrok-free.app", ".ngrok-free.dev", ".ngrok.io"],
          hmr: false,
          // The web app's server only: the landing page's own server serves "/".
          proxy: config.base === "/app/" ? { "^/(?!app(/|$))": { target: CLOUD, changeOrigin: true } } : undefined,
        },
      };
    },
  };
}

function coverageCollector(): Plugin {
  /** Where each page load was last saved, so a change of scenario moves it. */
  const savedAt = new Map<string, string>();
  return {
    name: "wysebee-e2e-coverage-collector",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (req.method !== "POST" || !path.endsWith(`/${ENDPOINT}`)) return next();
        try {
          const { scenario, loadId, coverage } = JSON.parse(await readBody(req));
          const dir = resolve(COVERAGE_DIR, safeName(scenario) || "default");
          mkdirSync(dir, { recursive: true });
          const id = safeName(loadId) || "page";
          const file = resolve(dir, `${id}.json`);
          writeFileSync(file, JSON.stringify(coverage));
          const before = savedAt.get(id);
          if (before && before !== file) rmSync(before, { force: true });
          savedAt.set(id, file);
          res.statusCode = 204;
          res.end();
        } catch (error) {
          res.statusCode = 400;
          res.end(String(error));
        }
      });
    },
    transformIndexHtml() {
      return [{ tag: "script", attrs: { type: "module" }, children: CLIENT, injectTo: "head" }];
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

/** A scenario or page-load id as a file name: letters, digits, `-`, `_` and `.` only. */
function safeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/[^\w.-]+/g, "_").replace(/^\.+/, "").slice(0, 80) : "";
}

/** Runs in the page. Coverage is too large for sendBeacon, so it is saved with fetch. */
const CLIENT = `
const loadId = new Date().toISOString().replace(/[:.]/g, "-") + "-" + Math.random().toString(36).slice(2, 8);
const url = new URL("${ENDPOINT}", document.baseURI).pathname;
function body(scenario) {
  if (!window.__coverage__) return null;
  if (!scenario) { try { scenario = localStorage.getItem("wysebee-coverage-scenario"); } catch {} }
  return JSON.stringify({ scenario: scenario || "default", loadId, coverage: window.__coverage__ });
}
window.__saveCoverage__ = async (scenario) => {
  const b = body(scenario);
  if (!b) return false;
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: b });
  return r.ok;
};
const saveQuietly = () => window.__saveCoverage__().catch(() => {});
setInterval(saveQuietly, 5000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveQuietly(); });
addEventListener("pagehide", saveQuietly);
`;
