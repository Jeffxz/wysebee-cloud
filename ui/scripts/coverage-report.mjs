#!/usr/bin/env node
/**
 * The report of the coverage that `yarn dev:coverage` / `yarn dev:app:coverage` saved to
 * ui/.nyc_output/<scenario>/ while the UI was driven (scripts/vite-coverage.ts).
 *
 *   yarn coverage:report                  all scenarios together, and a line for each
 *   yarn coverage:report login settings   only these scenarios
 *   yarn coverage:clean                   forget what was saved, before a new run
 *
 * Writes an HTML report to ui/coverage-e2e/index.html and prints a summary. Source files the
 * page never loaded are not in the coverage at all, so they are listed after it: they count
 * as 0% in no figure above them.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COVERAGE_DIR = join(UI_DIR, ".nyc_output");
const REPORT_DIR = join(UI_DIR, "coverage-e2e");
const SOURCE_DIRS = ["app/src", "shared", "cloud/src"];

const args = process.argv.slice(2);
if (args.includes("--clean")) {
  rmSync(COVERAGE_DIR, { recursive: true, force: true });
  rmSync(REPORT_DIR, { recursive: true, force: true });
  console.log("Cleared ui/.nyc_output and ui/coverage-e2e.");
  process.exit(0);
}

const saved = existsSync(COVERAGE_DIR)
  ? readdirSync(COVERAGE_DIR).filter((name) => statSync(join(COVERAGE_DIR, name)).isDirectory())
  : [];
const scenarios = args.length ? args : saved;
const missing = scenarios.filter((name) => !saved.includes(name));
if (missing.length) {
  console.error(`No coverage saved for: ${missing.join(", ")}. Saved: ${saved.join(", ") || "none"}.`);
  process.exit(1);
}
if (!scenarios.length) {
  console.error("No coverage saved yet. Run `yarn dev:coverage` or `yarn dev:app:coverage` and use the UI first.");
  process.exit(1);
}

const pct = (summary) => `${summary.pct.toFixed(1).padStart(5)}%`;
const line = (label, map) => {
  const s = map.getCoverageSummary();
  return `${label.padEnd(24)} statements ${pct(s.statements)}  branches ${pct(s.branches)}  functions ${pct(s.functions)}  lines ${pct(s.lines)}`;
};

const all = libCoverage.createCoverageMap({});
console.log("Per scenario:");
for (const scenario of scenarios) {
  const map = libCoverage.createCoverageMap({});
  for (const file of readdirSync(join(COVERAGE_DIR, scenario)).filter((f) => f.endsWith(".json"))) {
    map.merge(JSON.parse(readFileSync(join(COVERAGE_DIR, scenario, file), "utf8")));
  }
  all.merge(map);
  console.log(`  ${line(scenario, map)}`);
}

rmSync(REPORT_DIR, { recursive: true, force: true });
const context = libReport.createContext({ dir: REPORT_DIR, coverageMap: all, defaultSummarizer: "nested" });
reports.create("html").execute(context);
reports.create("json-summary").execute(context);
console.log("\nAll together:");
reports.create("text-summary").execute(context);

const loaded = new Set(all.files());
const sourceFiles = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name) ? [path] : [];
      })
    : [];
const neverLoaded = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(UI_DIR, dir))).filter((f) => !loaded.has(f));
if (neverLoaded.length) {
  console.log(`\n${neverLoaded.length} source files were never loaded (not in the figures above):`);
  for (const file of neverLoaded) console.log(`  ${relative(UI_DIR, file)}`);
}
console.log(`\nHTML report: ${join(REPORT_DIR, "index.html")}`);
