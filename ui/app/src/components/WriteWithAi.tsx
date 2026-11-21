import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Info, Sparkles } from "lucide-react";
import { cn, muted } from "@shared/cn";
import { ConflictError, pollAssistant, sendAssistantEdit, startAssistant, stopAssistant, type AssistantState, type PageKind } from "../api";
import { reasonOf } from "../workspaces";

export const timing = {
  /** How long one poll waits for the AI app, in seconds (the cloud caps it too). */
  pollWaitSeconds: 20,
  /** The person's typing is sent this long after they stop. */
  editDebounceMs: 600,
  /** After a failed poll, the next one waits this long. */
  retryMs: 3000,
  /** How long the copy button shows its tick. */
  copiedMs: 1500,
};

export interface WriteWithAi {
  /** Null until this page holds it (and while another page does). */
  state: AssistantState | null;
  busy: boolean;
  error: string | null;
  /** A page open elsewhere (another page, tab or device) took it; this one takes it back when
   * the person comes back to it, or asks to. */
  movedAway: boolean;
  /** Take it for this page now. */
  turnOn: () => Promise<void>;
}

/**
 * **Wysebee Assistant** for the page open in the editor (2026-11-14): the person's own AI app
 * (Claude, ChatGPT), connected to Wysebee Assistant in Wysebee Cloud, `/assistant/mcp`
 * (apps/cloud/workspace_assistant.py), reads and writes this page's text as the editor holds it.
 * **Always on** (2026-11-15, the person's call: no switch): the page takes it as soon as it is
 * loaded (`ready`), and takes it back when the person returns to the window after a page open
 * elsewhere took it — the page in front is the one the AI app writes. A long poll brings what
 * it writes into the editor at once (`onAiText`), unsaved — the person reviews it and saves; the
 * person's own edits are sent up so the AI app reads what is on screen. Leaving the page lets
 * it go.
 *
 * The page is a workspace's — or a skill's file (`kind` "skills", 2026-11-17). When the AI app
 * makes a skill (`create_skill`) it opens its SKILL.md: this page lets it go and `onOpened`
 * says where, so the screen can follow.
 */
export interface WriteWithAiOptions {
  kind?: PageKind;
  onOpened?: (opened: { skill_id: string; path: string }) => void;
}

export function useWriteWithAi(workspaceId: string, path: string, text: string, onAiText: (text: string) => void, ready = true, options: WriteWithAiOptions = {}): WriteWithAi {
  const kind = options.kind ?? "workspaces";
  const opened = useRef(options.onOpened);
  opened.current = options.onOpened;
  const [state, setState] = useState<AssistantState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movedAway, setMovedAway] = useState(false);
  // The revision the editor holds, and the text the cloud has from it.
  const revision = useRef(0);
  const synced = useRef<string | null>(null);
  const aiText = useRef(onAiText);
  aiText.current = onAiText;
  const on = !!state?.on;

  const take = useCallback((s: AssistantState) => {
    if (!s.on) {
      setState(null);
      setMovedAway(true);
      if (s.opened) opened.current?.(s.opened);
      return;
    }
    if (s.revision! > revision.current) {
      revision.current = s.revision!;
      if (s.writer === "ai" && typeof s.content === "string") {
        synced.current = s.content;
        aiText.current(s.content);
      }
    }
    setState(s);
  }, []);

  // What the page holds now, for a take that comes later (on focus).
  const current = useRef(text);
  current.current = text;
  const turnOn = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMovedAway(false);
    try {
      const sent = current.current;
      const s = await startAssistant(workspaceId, path, sent, kind);
      revision.current = s.revision!;
      synced.current = sent;
      setState(s);
    } catch (e) {
      setError(reasonOf(e));
    } finally {
      setBusy(false);
    }
  }, [workspaceId, path, kind]);

  // Taken as soon as the page is loaded.
  useEffect(() => {
    if (ready) void turnOn();
  }, [ready, turnOn]);

  // Taken back when the person returns to this window while this page does not hold it (a
  // page elsewhere took it, or taking it failed).
  const away = useRef(false);
  away.current = ready && !on && !busy;
  useEffect(() => {
    const back = () => {
      if (away.current && document.visibilityState === "visible") void turnOn();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [turnOn]);

  // While on: wait for the AI app, again and again.
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: number | undefined;
    const next = () => {
      pollAssistant(workspaceId, path, revision.current, timing.pollWaitSeconds, kind).then(
        (s) => {
          if (!live) return;
          setError(null);
          take(s);
          if (s.on) next();
        },
        (e) => {
          if (!live) return;
          setError(reasonOf(e));
          timer = window.setTimeout(next, timing.retryMs);
        },
      );
    };
    next();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [on, workspaceId, path, take, kind]);

  // The person's own edits, once they pause.
  useEffect(() => {
    if (!on || text === synced.current) return;
    const timer = window.setTimeout(() => {
      const sent = text;
      sendAssistantEdit(workspaceId, path, sent, revision.current, kind).then(
        (r) => {
          revision.current = r.revision;
          synced.current = sent;
        },
        (e) => {
          if (e instanceof ConflictError && e.detail) take(e.detail as unknown as AssistantState);
          else setError(reasonOf(e));
        },
      );
    }, timing.editDebounceMs);
    return () => window.clearTimeout(timer);
  }, [on, text, workspaceId, path, take, kind]);

  // Leaving the page while it holds it lets it go (not once a page elsewhere took it).
  const onHere = useRef(false);
  onHere.current = on;
  useEffect(
    () => () => {
      if (onHere.current) stopAssistant(workspaceId, kind).catch(() => undefined);
    },
    [workspaceId, kind],
  );

  return { state, busy, error, movedAway, turnOn };
}

/**
 * Beside the page's title (2026-11-15: always on, so no switch, and no status — the person's
 * call): the **Wysebee Assistant** badge with an info button whose panel says how to use it (ask
 * it, in the AI app, to write this page) and how to add it to the AI app, with the address to
 * copy. While a page open elsewhere holds it, a button takes it back.
 */
export function AssistantStatus({ ai }: { ai: WriteWithAi }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { state } = ai;
  // The panel closes on Escape and on a click outside it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const outside = (e: MouseEvent) => !box.current!.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", key);
    document.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("mousedown", outside);
    };
  }, [open]);
  // The address is the cloud's; the panel shows it once one has been answered.
  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), timing.copiedMs);
  };
  return (
    <div ref={box} className="relative flex min-w-0 items-center gap-2 text-xs">
      <span className="flex shrink-0 items-center gap-1.5">
        <Sparkles size={14} className={state ? "text-primary-600 dark:text-primary-400" : muted} aria-hidden />
        <span className={cn("font-medium", !state && muted)}>{t("workspaces.assistant.name")}</span>
      </span>
      <button
        type="button"
        className={ICON_BUTTON}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("workspaces.assistant.info")}
        title={t("workspaces.assistant.info")}
        data-track="Workspaces assistant info"
      >
        <Info size={14} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label={t("workspaces.assistant.info")} className="absolute left-0 top-full z-20 mt-1 flex w-80 flex-col gap-2 rounded-lg border border-stone-200 bg-white p-3 text-xs shadow-lg dark:border-stone-700 dark:bg-stone-800">
          <p className="font-medium">{t("workspaces.assistant.usage")}</p>
          <p className={muted}>{t("workspaces.assistant.setup")}</p>
          {state && (
            <div className="flex items-center gap-1 rounded-md border border-stone-200 bg-stone-50 px-2 py-1 dark:border-stone-700 dark:bg-stone-900">
              <code className="min-w-0 flex-1 break-all font-mono text-[11px]">{state.url}</code>
              <button type="button" className={ICON_BUTTON} onClick={() => void copy(state.url)} aria-label={t("workspaces.assistant.copy")} title={t("workspaces.assistant.copy")} data-track="Workspaces write with AI copy address">
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              </button>
            </div>
          )}
          <p className={muted}>{t("workspaces.assistant.howTo")}</p>
        </div>
      )}
      {!state && ai.movedAway && (
        <>
          <span className={cn("min-w-0 truncate", muted)} title={t("workspaces.assistant.elsewhere")}>
            {t("workspaces.assistant.elsewhere")}
          </span>
          <button type="button" className="shrink-0 font-medium text-primary-700 hover:underline disabled:opacity-60 dark:text-primary-300" disabled={ai.busy} onClick={() => void ai.turnOn()} data-track="Workspaces assistant use here">
            {t("workspaces.assistant.useHere")}
          </button>
        </>
      )}
      {ai.error && (
        <span className="min-w-0 truncate text-red-700 dark:text-red-300" title={ai.error}>
          {ai.error}
        </span>
      )}
    </div>
  );
}

const ICON_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700";
