import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Moon, RefreshCw, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { btn, cn, errorBanner, loading, muted } from "@shared/cn";
import { fetchDocumentPage, fetchPage, type WorkspacePage } from "../api";
import { setTheme, useTheme } from "../theme";
import { reasonOf } from "../workspaces";

/**
 * A page the person's AI app wrote (Wysebee Assistant's write_page), shown as it was made but
 * **sandboxed**: loaded from its own address, which Wysebee Cloud serves under a policy giving
 * it no origin and no network (apps/cloud/workspace_pages.py `VIEW_CSP`), and framed with no
 * origin of its own here too (`allow-scripts`, never `allow-same-origin`) — so its scripts run
 * but cannot reach Wysebee, its sign-in or the person's data, nor send what it shows anywhere.
 * (Not `srcdoc`: that would take this page's own policy, which refuses inline scripts.)
 */
export function PageFrame({ src, title, className }: { src: string; title: string; className?: string }) {
  // In Wysebee's look (2026-11-19): asked for in it when loaded, and told when it changes, so it
  // switches without reloading (apps/cloud/workspace_pages.py `THEME_SCRIPT`). Its address
  // changes only with a new page, not with the look.
  const theme = useTheme();
  const themeNow = useRef(theme);
  themeNow.current = theme;
  const frame = useRef<HTMLIFrameElement>(null);
  const themed = useMemo(() => `${src}${src.includes("?") ? "&" : "?"}theme=${themeNow.current}`, [src]);
  // Its origin is none (sandboxed), so the message goes to "*": it says only the look.
  const tell = useCallback(() => frame.current?.contentWindow?.postMessage({ wysebeeTheme: themeNow.current }, "*"), []);
  useEffect(tell, [theme, tell]);
  return (
    <iframe
      ref={frame}
      title={title}
      sandbox="allow-scripts"
      src={themed}
      onLoad={tell}
      referrerPolicy="no-referrer"
      className={cn("w-full rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900", className)}
    />
  );
}

/** The look's switch, in a corner of the page at its own address: Wysebee's own, saved with its
 * settings as on the rail (theme.ts). */
function ThemeSwitch() {
  const { t } = useTranslation();
  const dark = useTheme() === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("sideNav.darkMode")}
      title={t(dark ? "sideNav.toLight" : "sideNav.toDark")}
      // Large and solid so it is easy to find: a sliding switch like the rail's, kept clear of the
      // page's scrollbar.
      className="fixed right-6 top-4 z-10 flex h-12 items-center rounded-full border border-stone-300 bg-white p-1.5 shadow-lg transition-colors hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#855cd6] dark:border-stone-600 dark:bg-stone-800 dark:hover:bg-stone-700"
      onClick={() => void setTheme(dark ? "light" : "dark").catch((e) => toast.error(t("sideNav.themeNotSaved", { error: reasonOf(e) })))}
    >
      <span aria-hidden className={cn("relative flex h-9 w-16 items-center rounded-full px-1 transition-colors", dark ? "bg-[#6a4aab]" : "bg-stone-300")}>
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#4b3283] shadow transition-transform",
            dark && "translate-x-7",
          )}
        >
          {dark ? <Moon size={16} /> : <Sun size={16} />}
        </span>
      </span>
    </button>
  );
}

/** Whose work it is, and what it cannot do. */
function MadeByAi() {
  const { t } = useTranslation();
  return (
    <p className={cn(muted, "flex items-center gap-1.5 text-xs")}>
      <ShieldCheck size={14} aria-hidden /> {t("pages.sandboxed")}
    </p>
  );
}

/**
 * The editor's Page view: the page the AI app made from this document, read when shown and
 * again with Refresh (the AI app may write it meanwhile), with a link to its own address —
 * or how to get one.
 */
export function DocumentPage({ workspaceId, path }: { workspaceId: string; path: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<WorkspacePage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const { page: found } = await fetchDocumentPage(workspaceId, path);
      setPage(found ? await fetchPage(found.id) : null);
    } catch (e) {
      setError(reasonOf(e));
    }
  }, [workspaceId, path]);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <div className={errorBanner}>{error}</div>;
  if (page === undefined) return <div className={loading}>{t("pages.loading")}</div>;
  if (page === null)
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-stone-300 p-6 dark:border-stone-600">
        <p className="text-sm font-medium">{t("pages.none")}</p>
        <p className={cn(muted, "text-sm")}>{t("pages.howTo")}</p>
        <button type="button" className={btn} onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden /> {t("pages.refresh")}
        </button>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <MadeByAi />
        <span className="flex-1" />
        <button type="button" className={cn(btn, "text-xs")} onClick={() => void load()}>
          <RefreshCw size={13} aria-hidden /> {t("pages.refresh")}
        </button>
        <a className={cn(btn, "text-xs")} href={`#/pages/${encodeURIComponent(page.id)}`} target="_blank" rel="noopener">
          <ExternalLink size={13} aria-hidden /> {t("pages.open")}
        </a>
      </div>
      <PageFrame src={page.view_url} title={page.title || path} className="min-h-[60vh] flex-1" />
    </div>
  );
}

/**
 * A page at its own address, `#/pages/<id>`: the page alone, filling the window with none of
 * Wysebee's own UI around it (2026-11-19, the person's call) — what "Open on its own" opens,
 * in a new tab, so whoever looks sees just what the AI app made. Still framed sandboxed, and
 * read with the person's sign-in, so its address stays the same when the AI app writes it again.
 * Only a small switch for the look sits over it, in a corner.
 */
export function PageView({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState<WorkspacePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPage(null);
    setError(null);
    fetchPage(pageId).then(
      (p) => live && setPage(p),
      (e) => live && setError(reasonOf(e)),
    );
    return () => {
      live = false;
    };
  }, [pageId]);
  const title = page ? page.title || page.source_path : null;
  useEffect(() => {
    if (!title) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
  if (error)
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <div className={errorBanner}>{error}</div>
      </div>
    );
  if (!page || !title)
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <div className={loading}>{t("pages.loading")}</div>
      </div>
    );
  return (
    <main aria-label={title} className="fixed inset-0 bg-white dark:bg-stone-900" data-track-private>
      <PageFrame src={page.view_url} title={title} className="block h-full rounded-none border-0" />
      <ThemeSwitch />
    </main>
  );
}
