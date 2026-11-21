import { useEffect, useId, useRef, useState } from "react";
import { CHART_MESSAGE_KEY, CHART_RUN_KEY, chartSrcDoc } from "./chartRuntime";
import { cn } from "./cn";

/**
 * How a chart's frame is made — see chartRuntime.ts for why the two apps differ:
 * - `srcdoc`: the desktop inlines d3 (loaded on first use) and the code;
 * - `page`: the extension points at its sandboxed chart page and posts the code to it.
 */
export type ChartSource =
  | { kind: "srcdoc"; d3: () => Promise<string> }
  | { kind: "page"; url: string };

export interface ChartLabels {
  /** The frame's accessible name. */
  title: string;
  /** Shown while d3 loads, before the frame exists. */
  loading: string;
  /** "The chart could not be drawn: {error}" — the caller formats it. */
  failed: (error: string) => string;
  /** The <summary> of the code, under a failed chart. */
  showCode: string;
}

// Tall enough for any sane chart, short enough that a runaway one cannot push the
// conversation off the screen.
const MAX_HEIGHT = 900;
const INITIAL_HEIGHT = 160;

/**
 * An agent's ```d3 block, drawn. The code runs in a sandboxed frame (scripts only, an
 * opaque origin, no network) and reports its height and errors by postMessage.
 */
export function ChartView({ code, source, labels }: { code: string; source: ChartSource; labels: ChartLabels }) {
  const id = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const [srcDoc, setSrcDoc] = useState<string | null>(null);
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source.kind !== "srcdoc") return;
    let live = true;
    source
      .d3()
      // In the page's look: the desktop puts `dark` on <html> by its own setting (theme.ts).
      .then((d3) => live && setSrcDoc(chartSrcDoc(d3, id, code, document.documentElement.classList.contains("dark"))))
      .catch((e) => live && setError(String(e instanceof Error ? e.message : e)));
    return () => {
      live = false;
    };
  }, [code, id, source]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this chart's own frame: every frame posts to the same window.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const data = e.data as Record<string, unknown> | null;
      if (!data || !(CHART_MESSAGE_KEY in data)) return;
      if (data.ready === true && source.kind === "page") {
        frame.current.contentWindow?.postMessage({ [CHART_RUN_KEY]: true, id, code }, "*");
        return;
      }
      if (typeof data.height === "number" && data.height > 0) {
        setHeight(Math.min(Math.max(data.height, 24), MAX_HEIGHT));
      }
      if (typeof data.error === "string") setError(data.error);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [code, id, source]);

  const ready = source.kind === "page" || srcDoc !== null;
  return (
    <div className="flex flex-col gap-1">
      {ready ? (
        <iframe
          ref={frame}
          title={labels.title}
          // Scripts only: no same-origin (so no access to this page, its bridge or its
          // storage), no forms, popups, navigation of this page or downloads.
          sandbox="allow-scripts"
          className={cn("w-full rounded-md border-0 bg-transparent", error && "hidden")}
          style={{ height }}
          {...(source.kind === "page" ? { src: source.url } : { srcDoc: srcDoc /* v8 ignore next -- @preserve: a srcdoc frame renders only once srcDoc is set */ ?? "" })}
        />
      ) : (
        !error && <div className="py-6 text-center text-xs text-stone-500 dark:text-stone-400">{labels.loading}</div>
      )}
      {error && (
        <div className="flex flex-col gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <span>{labels.failed(error)}</span>
          <details>
            <summary className="cursor-pointer select-none">{labels.showCode}</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-1.5 font-mono text-stone-700 dark:bg-white/10 dark:text-stone-200">
              {code}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
