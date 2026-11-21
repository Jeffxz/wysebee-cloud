import { describe, expect, it } from "vitest";
import { CHART_MESSAGE_KEY, CHART_PAGE_HTML, CHART_PAGE_JS, CHART_RUN_KEY, CHART_RUNTIME, chartSrcDoc } from "./chartRuntime";

describe("chartSrcDoc", () => {
  it("inlines the id, runtime, d3 and code, with no script able to close its own element", () => {
    const doc = chartSrcDoc("var d3 = '</script>';", "r:1", "root.textContent = '</SCRIPT>';");
    expect(doc).toContain('window.__chartId = "r:1";');
    expect(doc).toContain(CHART_RUNTIME);
    expect(doc).toContain("var d3 = '<\\/script>';");
    expect(doc).toContain("root.textContent = '<\\/SCRIPT>';");
    expect(doc.match(/<\/script>/g)).toHaveLength(4);
  });

  it("draws in the desktop's look: light, or dark when told", () => {
    expect(chartSrcDoc("", "r", "")).toMatch(/^<!doctype html><html class="light"><head>/);
    expect(chartSrcDoc("", "r", "", true)).toMatch(/^<!doctype html><html class="dark"><head>/);
  });

  it("tags the extension page's messages with the shared keys", () => {
    expect(CHART_RUNTIME).toContain(CHART_MESSAGE_KEY);
    expect(CHART_PAGE_JS).toContain(CHART_RUN_KEY);
    expect(CHART_PAGE_HTML).toContain("chart.js");
  });
});
