import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Wrench, X } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, muted, surface } from "@shared/cn";
import { fetchPageToolGrants, revokePageToolGrant, runPageTool, type PageToolAsk, type PageToolGrant } from "../api";
import { reasonOf } from "../workspaces";

/** Said to the page when the person says no (the page's own words are its business). */
export const DECLINED = "The person did not allow this tool.";

interface Call {
  id: number;
  agent: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/** A page's `wysebee.callTool` message (apps/cloud/page_tools.py `BRIDGE_SCRIPT`), checked. */
function callOf(data: unknown): Call | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.wysebee !== "call" || typeof d.id !== "number" || typeof d.agent !== "string" || typeof d.tool !== "string") return null;
  const args = d.arguments;
  if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) return null;
  return { id: d.id, agent: d.agent, tool: d.tool, arguments: (args as Record<string, unknown>) ?? {} };
}

/** The view key in a page's address (`/api/v1/page-view/<id>/<key>`): which copy of it is asking. */
export function viewKeyOf(src: string): string {
  const path = src.split("?")[0];
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The page's tools (2026-11-28): the sandboxed page posts `{wysebee: "call", …}` to this window;
 * only a message from **its own frame** is taken (`e.source`), the tool is run with the person's
 * sign-in (apps/cloud/page_tools.py), and the answer posted back to that frame alone. A tool the
 * person has not allowed for this page is put to them first, one at a time ({@link
 * PageToolApproval}). Returns the dialog to render, if one is open.
 */
export function usePageToolBridge(frame: RefObject<HTMLIFrameElement | null>, pageId: string | undefined, src: string, title: string, onAllowed?: () => void) {
  const queue = useRef<{ call: Call; ask: PageToolAsk }[]>([]);
  const [asking, setAsking] = useState<{ call: Call; ask: PageToolAsk } | null>(null);
  const viewKey = viewKeyOf(src);

  const reply = useCallback(
    (id: number, answer: { text: string; images: unknown[]; isError: boolean } | { error: string }) =>
      // Its origin is none (sandboxed): "*", to this frame's window only.
      frame.current?.contentWindow?.postMessage({ wysebee: "result", id, ...answer }, "*"),
    [frame],
  );

  const run = useCallback(
    async (call: Call, allow?: "once" | "always") => {
      try {
        // Only called once a message came, which is listened for only with a page id.
        const out = await runPageTool(pageId!, { agent: call.agent, tool: call.tool, arguments: call.arguments, view_key: viewKey, allow });
        if ("ask" in out) {
          queue.current.push({ call, ask: out.ask });
          setAsking((now) => now ?? queue.current.shift()!);
          return;
        }
        if (allow) onAllowed?.();
        reply(call.id, { text: out.result.text, images: out.result.images, isError: out.result.is_error });
      } catch (e) {
        reply(call.id, { error: reasonOf(e) });
      }
    },
    [pageId, viewKey, reply, onAllowed],
  );

  useEffect(() => {
    if (!pageId) return;
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const call = callOf(e.data);
      if (call) void run(call);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, pageId, run]);

  const answer = (call: Call, allow: "once" | "always" | null) => {
    if (allow) void run(call, allow);
    else reply(call.id, { error: DECLINED });
    setAsking(queue.current.shift() ?? null);
  };

  return asking ? <PageToolApproval page={title} ask={asking.ask} args={asking.call.arguments} onAnswer={(allow) => answer(asking.call, allow)} /> : null;
}

/** Whether the page may run a tool: once, always (until it changes, for one that changes something), or not. */
export function PageToolApproval({
  page,
  ask,
  args,
  onAnswer,
}: {
  page: string;
  ask: PageToolAsk;
  args: Record<string, unknown>;
  onAnswer: (allow: "once" | "always" | null) => void;
}) {
  const { t } = useTranslation();
  const shown = JSON.stringify(args, null, 2);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onAnswer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 text-stone-900 dark:text-stone-100">
      <div role="alertdialog" aria-modal="true" aria-label={t("pages.tools.ask")} className={cn(surface, "flex w-full max-w-md flex-col gap-3 p-5 shadow-xl")}>
        <h2 className="text-base font-semibold">{t("pages.tools.ask")}</h2>
        <p className="text-sm">{t("pages.tools.wants", { page, tool: ask.tool, agent: ask.agent })}</p>
        <p className={cn("text-sm", ask.reads ? muted : "font-medium text-amber-700 dark:text-amber-300")}>{t(ask.reads ? "pages.tools.reads" : "pages.tools.changes")}</p>
        {shown !== "{}" && (
          <pre aria-label={t("pages.tools.with")} className="max-h-40 overflow-auto rounded bg-stone-100 p-2 font-mono text-xs dark:bg-stone-800">
            {shown.length > 2000 ? `${shown.slice(0, 2000)}…` : shown}
          </pre>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {/* Focus on "Don't allow": a page may ask while the person types in it, and Enter must not say yes. */}
          <button type="button" className={btn} autoFocus onClick={() => onAnswer(null)} data-track="Page tool declined">
            {t("pages.tools.deny")}
          </button>
          <button type="button" className={btn} onClick={() => onAnswer("always")} data-track="Page tool always">
            {t(ask.reads ? "pages.tools.always" : "pages.tools.untilChanged")}
          </button>
          <button type="button" className={btnPrimary} onClick={() => onAnswer("once")} data-track="Page tool once">
            {t("pages.tools.once")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The tools a page may run without asking, each to be taken back; shown when it has some. */
export function PageToolGrants({ pageId, count, onChange }: { pageId: string; count: number; onChange: (count: number) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<PageToolGrant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchPageToolGrants(pageId).then(
      (g) => setGrants(g.grants),
      (e) => setError(reasonOf(e)),
    );
  }, [open, pageId]);
  if (count === 0) return null;
  const revoke = async (g: PageToolGrant) => {
    try {
      await revokePageToolGrant(pageId, g.agent, g.tool);
      // Taken back from the list shown, so it has been read.
      const left = grants!.filter((x) => x !== g);
      setGrants(left);
      onChange(left.length);
    } catch (e) {
      setError(reasonOf(e));
    }
  };
  return (
    <div className="relative">
      <button type="button" className={cn(btn, "text-xs")} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Wrench size={13} aria-hidden /> {t("pages.tools.button", { count })}
      </button>
      {open && (
        <div role="dialog" aria-label={t("pages.tools.title")} className={cn(surface, "absolute right-0 top-full z-20 mt-1 flex w-80 flex-col gap-2 p-3 shadow-lg")}>
          <p className="text-sm font-medium">{t("pages.tools.title")}</p>
          {error && <div className={errorBanner}>{error}</div>}
          <ul className="flex flex-col gap-1">
            {(grants ?? []).map((g) => (
              <li key={`${g.agent}/${g.tool}`} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  @{g.agent} · {g.tool}
                </span>
                <span className={cn(muted, "text-xs")}>{t(!g.current ? "pages.tools.asksAgain" : g.reads ? "pages.tools.readsShort" : "pages.tools.changesShort")}</span>
                <button type="button" className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-700" onClick={() => void revoke(g)} aria-label={t("pages.tools.revoke", { tool: g.tool })} title={t("pages.tools.revoke", { tool: g.tool })}>
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
