import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { ChatMarkdown, MARKDOWN_CLASSES } from "./ChatMarkdown";
import { cn } from "./cn";

/**
 * Tool calls in a transcript — a task run's steps — rendered from here.
 *
 * - **Calls in a row are one group**: everything the model called between two things it
 *   said, across tool rounds, collapses under one line ("Used 6 tools") with a chevron;
 *   opened, it lists each call by name. A lone call is a row of its own.
 * - **A call shows its output only**, never its input: a JSON array as a list, other JSON
 *   formatted and coloured, markdown rendered, anything else as it came — each with a copy
 *   button at its top right.
 * - **Each call stays folded** until the person opens it.
 *
 * Strings come from the app (`labels`): each app has its own translations.
 */

/**
 * Copying an output's text: the app's own way when it has one (the desktop goes through its
 * shell), else the page's clipboard. Answers whether it worked.
 */
export const TextCopierContext = createContext<(text: string) => Promise<boolean>>(async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
});

export interface ToolStep {
  id: string;
  name: string;
  /** Undefined while the call has not answered (or never ran: the turn was stopped). */
  result?: { content: string; is_error?: boolean };
}

export interface ToolLabels {
  /** "Used 3 tools" */
  used: (count: number) => string;
  /** "1 failed" */
  failed: (count: number) => string;
  error: string;
  notRun: string;
  noOutput: string;
  /** The copy button on an output, and what it says once copied. */
  copy: string;
  copied: string;
}

/** What a chat transcript renders, in order: a message, or a run of tool calls. */
export type ChatItem<M> =
  | { kind: "message"; message: M; index: number }
  | { kind: "tools"; steps: ToolStep[]; key: string };

interface ToolMessageLike {
  role: string;
  content?: string;
  tool_calls?: { id: string; name: string }[];
  tool_call_id?: string;
  is_error?: boolean;
}

/**
 * Split a transcript into items: each user message and each assistant message's text
 * stands alone, and the tool calls between them become one run — calls from several
 * assistant messages in a row (one per tool round) join while nothing is said between
 * them. A tool result attaches to its call.
 */
export function chatItems<M extends ToolMessageLike>(messages: M[]): ChatItem<M>[] {
  const results = new Map<string, { content: string; is_error?: boolean }>();
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) {
      results.set(m.tool_call_id, { content: m.content ?? "", is_error: m.is_error });
    }
  }
  const items: ChatItem<M>[] = [];
  let run: ToolStep[] = [];
  const flush = () => {
    if (run.length) items.push({ kind: "tools", steps: run, key: run[0].id });
    run = [];
  };
  messages.forEach((m, index) => {
    if (m.role === "tool") return;
    if (m.role === "assistant") {
      if (m.content) {
        flush();
        items.push({ kind: "message", message: m, index });
      }
      for (const c of m.tool_calls ?? []) {
        run.push({ id: c.id, name: c.name, result: results.get(c.id) });
      }
      return;
    }
    flush();
    items.push({ kind: "message", message: m, index });
  });
  flush();
  return items;
}

/** A run of tool calls: one row when alone, else a group under one chevron. */
export function ToolCalls({ steps, labels }: { steps: ToolStep[]; labels: ToolLabels }) {
  return steps.length === 1 ? <ToolRow step={steps[0]} labels={labels} /> : <ToolGroup steps={steps} labels={labels} />;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={14}
      className={cn("shrink-0 transition-transform", open && "rotate-90")}
      aria-hidden
    />
  );
}

function stateOf(step: ToolStep): "ok" | "error" | "pending" {
  return !step.result ? "pending" : step.result.is_error ? "error" : "ok";
}

function Dot({ state }: { state: "ok" | "error" | "pending" }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        state === "ok" && "bg-green-500",
        state === "error" && "bg-red-500",
        state === "pending" && "bg-stone-400",
      )}
    />
  );
}

const frame =
  "rounded-md border border-stone-200 bg-white text-xs dark:border-stone-700 dark:bg-stone-800";

function ToolGroup({ steps, labels }: { steps: ToolStep[]; labels: ToolLabels }) {
  const [open, setOpen] = useState(false);
  const failed = steps.filter((s) => stateOf(s) === "error").length;
  const names = [...new Set(steps.map((s) => s.name))];
  return (
    <div className={frame}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-track="Chat tool group"
      >
        <Chevron open={open} />
        <span className="font-medium">{labels.used(steps.length)}</span>
        {failed > 0 && <span className="text-red-600 dark:text-red-400">· {labels.failed(failed)}</span>}
        {!open && (
          <span className="min-w-0 truncate font-mono text-stone-500 dark:text-stone-400">
            {names.join(", ")}
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-stone-200 p-1.5 dark:border-stone-700">
          {steps.map((s) => (
            <ToolRow key={s.id} step={s} labels={labels} nested />
          ))}
        </div>
      )}
    </div>
  );
}

/** One call: its name and state; opened, its output. */
export function ToolRow({
  step,
  labels,
  nested = false,
}: {
  step: ToolStep;
  labels: ToolLabels;
  nested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const state = stateOf(step);
  return (
    <div className={nested ? "rounded border border-stone-100 dark:border-stone-700/60" : frame}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!step.result}
        data-track="Chat tool call"
      >
        {step.result ? <Chevron open={open} /> : <span className="w-3.5" />}
        <Dot state={state} />
        <span className="font-mono">{step.name}</span>
        {state !== "ok" && (
          <span className="text-stone-500 dark:text-stone-400">
            {state === "error" ? labels.error : labels.notRun}
          </span>
        )}
      </button>
      {open && step.result && (
        <div className="border-t border-stone-200 px-2.5 py-2 dark:border-stone-700">
          <Output content={step.result.content} empty={labels.noOutput} labels={labels} />
        </div>
      )}
    </div>
  );
}

// "[image attached]", "[an image the model saw during this turn; …]" and the like.
const IMAGE_MARKERS = /(\[[^[\]]*\bimages?\b[^[\]]*\]\s*)+$/;

const pre =
  "max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 p-1.5 pr-8 font-mono text-[11px] leading-relaxed dark:bg-white/10";

/**
 * A tool's output: a JSON array as a list, other JSON formatted and coloured, markdown
 * rendered, anything else as it came — with a copy button at its top right.
 */
export function Output({ content, empty, labels }: { content: string; empty: string; labels: Pick<ToolLabels, "copy" | "copied"> }) {
  // A result that carried a picture ends with a marker for it ("[image attached]"); the
  // picture is not shown here, so the marker is dropped.
  const text = content.trim().replace(IMAGE_MARKERS, "").trim();
  if (!text) return <p className="italic text-stone-500 dark:text-stone-400">{empty}</p>;
  const parsed = parseJson(text);
  const body =
    parsed === undefined ? (
      looksLikeMarkdown(text) ? (
        <div className={cn("max-h-72 overflow-auto pr-7 text-xs", MARKDOWN_CLASSES)}>
          <ChatMarkdown text={text} link={outputLink} />
        </div>
      ) : (
        <pre className={pre}>{text}</pre>
      )
    ) : Array.isArray(parsed) && parsed.length > 0 ? (
      <JsonList items={parsed} />
    ) : (
      <pre className={pre}>{renderJson(parsed, 0)}</pre>
    );
  return (
    <div className="relative">
      {body}
      <CopyButton text={parsed === undefined ? text : JSON.stringify(parsed, null, 2)} labels={labels} />
    </div>
  );
}

// Only http(s) links, in a new tab — as the model's own answers.
const outputLink = (href: string | undefined, children: ReactNode) =>
  href && /^https?:\/\//i.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary-700 underline dark:text-primary-300">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );

// Headings, fences, tables, links, bold or lists. A page snapshot's outline ("- button
// \"Send\" [ref=e3]") is lists too, but not prose: its `[ref` marks keep it as text.
const MARKDOWN = [/^#{1,6}\s/m, /^```/m, /^\|.+\|\s*$/m, /\[[^\]\n]+\]\([^)\s]+\)/, /\*\*[^*\n]+\*\*/, /^\s*(?:[-*+]|\d+\.)\s+\S/m];
export function looksLikeMarkdown(text: string): boolean {
  if (/\[ref[=_]/.test(text)) return false;
  return MARKDOWN.some((re) => re.test(text));
}

/** A JSON array: one row per item — a value as text, an object as its fields. */
function JsonList({ items }: { items: unknown[] }) {
  return (
    <ol className="max-h-72 list-none space-y-1 overflow-auto pr-7 text-[11px]">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 rounded bg-black/5 px-2 py-1 dark:bg-white/10">
          <span className="shrink-0 tabular-nums text-stone-400">{i + 1}.</span>
          <div className="min-w-0 flex-1 break-words">
            {item !== null && typeof item === "object" && !Array.isArray(item) ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                {Object.entries(item as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-primary-700 dark:text-primary-300">{k}</dt>
                    <dd className="min-w-0 break-words font-mono">{scalar(v)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <span className="font-mono">{scalar(item)}</span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

// A field's value on one line: text as it is, anything else as compact JSON.
const scalar = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** Copy an output; it says so for a moment once done. */
function CopyButton({ text, labels }: { text: string; labels: Pick<ToolLabels, "copy" | "copied"> }) {
  const copy = useContext(TextCopierContext);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const label = copied ? labels.copied : labels.copy;
  return (
    <button
      type="button"
      className="absolute right-1.5 top-1.5 rounded-md border border-stone-200 bg-white/90 p-1 text-stone-600 shadow-sm hover:bg-white hover:text-stone-900 dark:border-stone-600 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:bg-stone-800"
      onClick={() =>
        void copy(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1500);
        })
      }
      title={label}
      aria-label={label}
      data-track="Copy tool output"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function parseJson(text: string): unknown {
  if (!(text.startsWith("{") || text.startsWith("["))) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const INDENT = "  ";

function renderJson(value: unknown, depth: number): ReactNode {
  const pad = INDENT.repeat(depth + 1);
  const close = INDENT.repeat(depth);
  if (value === null) return <span className="text-stone-500">null</span>;
  if (typeof value === "string") {
    return <span className="text-emerald-700 dark:text-emerald-400">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") return <span className="text-amber-700 dark:text-amber-400">{value}</span>;
  if (typeof value === "boolean") {
    return <span className="text-sky-700 dark:text-sky-400">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return (
      <>
        {"[\n"}
        {value.map((v, i) => (
          <span key={i}>
            {pad}
            {renderJson(v, depth + 1)}
            {i < value.length - 1 ? ",\n" : "\n"}
          </span>
        ))}
        {close}
        {"]"}
      </>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return (
    <>
      {"{\n"}
      {entries.map(([k, v], i) => (
        <span key={k}>
          {pad}
          <span className="text-primary-700 dark:text-primary-300">{JSON.stringify(k)}</span>
          {": "}
          {renderJson(v, depth + 1)}
          {i < entries.length - 1 ? ",\n" : "\n"}
        </span>
      ))}
      {close}
      {"}"}
    </>
  );
}
