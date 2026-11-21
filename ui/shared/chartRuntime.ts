/**
 * What runs *inside* a chart's frame: an agent's ```d3 block, drawn with d3 into an
 * empty `root`, in a sandboxed iframe (`sandbox="allow-scripts"`, no same-origin) — so
 * the code reaches neither the page, its bridge to the app, nor storage; and the frame's
 * CSP allows no network (the desktop's `connect-src 'self'` is inherited by a srcdoc;
 * the extension's sandbox page sets `connect-src 'none'`).
 *
 * Two ways in, one runtime:
 * - **Desktop**: a `srcdoc` with d3, this runtime and the code inlined as scripts — the
 *   SPA's CSP allows inline script and a srcdoc inherits it (no eval needed).
 * - **Extension**: Manifest V3 forbids inline script in extension pages, so a sandboxed
 *   page of its own (`ui/chart.html`, built from {@link CHART_PAGE_HTML} and
 *   {@link CHART_PAGE_JS} by the extension's Vite config, declared under `sandbox` in the
 *   manifest with a CSP that allows eval) receives the code by postMessage.
 *
 * The frame tells its parent its height and any error, tagged with the chart's id.
 *
 * Plain ES5-ish JavaScript in strings: it runs in the frame, never in the page, and the
 * extension's copy is a classic script the bundler never sees.
 */

/** Messages a frame sends carry this key, set to the chart's id. */
export const CHART_MESSAGE_KEY = "wysebeeChart";
/** The message that hands the extension's chart page its code. */
export const CHART_RUN_KEY = "wysebeeChartRun";

export const CHART_STYLE = `
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; background: transparent; }
body { font: 12px system-ui, -apple-system, "Segoe UI", sans-serif; color: #292524; }
@media (prefers-color-scheme: dark) { body { color: #f5f5f4; } }
html.light { color-scheme: light; } html.light body { color: #292524; }
html.dark { color-scheme: dark; } html.dark body { color: #f5f5f4; }
#root { width: 100%; overflow-x: auto; }
svg { max-width: 100%; height: auto; overflow: visible; }
`;

export const CHART_RUNTIME = `
(function () {
  function post(m) {
    m.${CHART_MESSAGE_KEY} = window.__chartId || "";
    parent.postMessage(m, "*");
  }
  function report() {
    post({ height: Math.ceil(document.documentElement.scrollHeight) });
  }
  window.__chartPost = post;
  window.addEventListener("error", function (e) {
    post({ error: String((e && e.message) || "The chart's code failed.") });
  });
  window.__runChart = function (run) {
    var root = document.getElementById("root");
    if (window.ResizeObserver) new ResizeObserver(report).observe(document.body);
    Promise.resolve()
      .then(function () { return run(window.d3, root); })
      .then(report, function (e) { post({ error: String((e && e.message) || e) }); });
  };
})();
`;

/** Inline script text must not close its own <script> element. */
const scriptSafe = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1");

/** The desktop's frame: everything inline, in the page's own look (`dark`: the desktop's
 * theme, which need not be the computer's; the extension's chart page follows the
 * computer). */
export function chartSrcDoc(d3Source: string, id: string, code: string, dark = false): string {
  return [
    `<!doctype html><html class="${dark ? "dark" : "light"}"><head><meta charset="utf-8">`,
    `<style>${CHART_STYLE}</style></head><body><div id="root"></div>`,
    `<script>window.__chartId = ${JSON.stringify(id)};</script>`,
    `<script>${CHART_RUNTIME}</script>`,
    `<script>${scriptSafe(d3Source)}</script>`,
    `<script>__runChart(async function (d3, root) {\n${scriptSafe(code)}\n});</script>`,
    "</body></html>",
  ].join("");
}

/** The extension's sandboxed chart page; d3.min.js and chart.js sit beside it. */
export const CHART_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><link rel="stylesheet" href="chart.css"></head>
<body><div id="root"></div>
<script src="d3.min.js"></script>
<script src="chart.js"></script>
</body></html>
`;

export const CHART_PAGE_JS = `${CHART_RUNTIME}
window.addEventListener("message", function onRun(e) {
  var d = e.data;
  if (e.source !== parent || !d || d.${CHART_RUN_KEY} !== true) return;
  window.removeEventListener("message", onRun);
  window.__chartId = String(d.id || "");
  var run;
  try {
    run = new Function("d3", "root", "return (async function () {\\n" + String(d.code || "") + "\\n})();");
  } catch (err) {
    window.__chartPost({ error: String((err && err.message) || err) });
    return;
  }
  window.__runChart(run);
});
parent.postMessage({ ${CHART_MESSAGE_KEY}: "", ready: true }, "*");
`;
