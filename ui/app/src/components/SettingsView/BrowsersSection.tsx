import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Laptop, Monitor, Server, Smartphone, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { btn, cn, muted } from "@shared/cn";
import { loadAgents } from "../../agents";
import { refreshLinks } from "../../presence";
import { fetchBrowserLinks, unpairBrowserLink, UnauthorizedError, type BrowserLink } from "../../api";
import { ago } from "./DesktopsSection";
import { AREA, linkKind, PairBrowserDialog, TRACK, type PairKind } from "./PairBrowserDialog";
import { dialogs } from "../common/confirm";

const ICON: Record<PairKind, LucideIcon> = { browser: Globe, osx: Laptop, windows: Monitor, linux: Server, android: Smartphone };

/** How often the list is read again while it shows: a browser connects and closes on its own. */
export const BROWSERS_REFRESH_MS = 30_000;

/** The account's links (both kinds), read now, every half minute and on `load()`; `error`
 * is the last read's failure, if it failed. */
export function useLinks(): { links: BrowserLink[] | null; error: unknown; load: () => Promise<void> } {
  const [links, setLinks] = useState<BrowserLink[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      setLinks((await fetchBrowserLinks()).links);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), BROWSERS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  return { links, error, load };
}

/** Why the links could not be read, in words to show. */
export function linksProblem(error: unknown, t: (key: string) => string): string | null {
  if (!error) return null;
  return error instanceof UnauthorizedError ? t("settings.browsers.signedOut") : error instanceof Error ? error.message : String(error);
}

/** Unpair `link` (asked first in its kind's words), then `reload` — with Home's agents, since
 * an unpairing changes one, and the Devices menu's links. */
export async function unpairLink(link: BrowserLink, t: (key: string, opts?: Record<string, unknown>) => string, reload: () => Promise<void>): Promise<void> {
  const sure = t(`${AREA[linkKind(link)]}.unpairConfirm`, { device: link.browser, label: link.label });
  if (!(await dialogs.confirm(sure, { action: "unpair" }))) return;
  try {
    await unpairBrowserLink(link.id);
    await Promise.all([reload(), loadAgents(), refreshLinks()]);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : String(e));
  }
}

/** One paired link's row: its agent, what it is paired with, whether it is reached, and Unpair;
 * its name opens the device's page (`onOpen`). */
export function LinkRow({ link, onUnpair, onOpen }: { link: BrowserLink; onUnpair: (link: BrowserLink) => void; onOpen: (link: BrowserLink) => void }) {
  const { t, i18n } = useTranslation();
  const kind = linkKind(link);
  const Icon = ICON[kind];
  /* v8 ignore next -- @preserve: i18n has resolved a language before any page renders */
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <Icon size={18} className="shrink-0 text-stone-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <button type="button" className="truncate text-left underline-offset-2 hover:underline" onClick={() => onOpen(link)} data-track="Open device">
            {link.label}
          </button>
          <span className={cn(muted, "shrink-0 font-normal")}>@{link.agent}</span>
          {link.paused && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {t("settings.browsers.pausedBadge")}
            </span>
          )}
        </div>
        <div className={cn(muted, "truncate text-[11px]")}>
          {[link.agent_type?.name, link.browser, link.extension_version && t("settings.browsers.version", { version: link.extension_version })].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs">
        <span className={cn("h-2 w-2 rounded-full", link.status === "connected" ? "bg-green-500" : "bg-stone-400")} aria-hidden />
        <span>
          {link.status === "connected"
            ? t("settings.browsers.connected")
            : link.last_seen
              ? t("settings.browsers.offline", { when: ago(link.last_seen, new Date(), locale) })
              : t("settings.browsers.offlineNever")}
        </span>
      </div>
      <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={() => onUnpair(link)} data-track={kind === "osx" ? "Unpair Mac agent" : `Unpair ${TRACK[kind]}`}>
        {t("settings.browsers.unpair")}
      </button>
    </li>
  );
}

/**
 * Devices, "Browsers": the browsers paired with the **Wysebee Agent** extension (the
 * cloud's apps/cloud/browser_links.py). Each has an agent of its own — made by the pairing,
 * and the only one that drives it — shown by its name and "@" handle, with the browser,
 * whether the extension is reaching Wysebee Cloud now (**connected**) or not (**offline**,
 * with when it last did), and whether the person **paused** it there (`LinkRow`). **Unpair**
 * (asked first) deletes the link: the agent stays, without a browser. **Pair a browser** opens
 * the dialog that takes the extension's code. Read again every half minute while shown.
 *
 * The Macs and Windows PCs paired with **Wysebee Agent** (links of kind `osx`) and the phones
 * (kind `android`) are devices running an agent, listed under "Your devices" (DesktopsSection).
 */
export function BrowsersSection({ onOpenAgent, onOpenDevice }: { onOpenAgent: (name: string) => void; onOpenDevice: (id: string) => void }) {
  const { t } = useTranslation();
  const { links, error, load } = useLinks();
  const [pairing, setPairing] = useState(false);
  const problem = linksProblem(error, t);
  const browsers = links && links.filter((l) => linkKind(l) === "browser");

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-medium">{t("settings.browsers.heading")}</div>
        <button type="button" className={cn(btn, "px-2 py-1 text-xs")} onClick={() => setPairing(true)} data-track="Pair a browser">
          {t("settings.browsers.pair")}
        </button>
      </div>
      <p className={cn(muted, "mt-0.5 mb-2 text-[11px]")}>{t("settings.browsers.hint")}</p>
      {problem && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
      {browsers !== null && browsers.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-700 dark:border-stone-700" data-track-private>
          {browsers.map((link) => (
            <LinkRow key={link.id} link={link} onUnpair={(l) => void unpairLink(l, t, load)} onOpen={(l) => onOpenDevice(l.id)} />
          ))}
        </ul>
      )}
      {browsers === null ? (
        !problem && <p className={cn(muted, "mt-2 text-xs")}>{t("settings.browsers.loading")}</p>
      ) : (
        browsers.length === 0 && <p className={cn(muted, "mt-2 text-xs")}>{t("settings.browsers.none")}</p>
      )}
      {pairing && (
        <PairBrowserDialog
          onClose={() => setPairing(false)}
          onPaired={() => void Promise.all([load(), loadAgents(), refreshLinks()])}
          onOpenAgent={(name) => {
            setPairing(false);
            onOpenAgent(name);
          }}
        />
      )}
    </div>
  );
}
