import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, Cloud } from "lucide-react";
import { btn, cn, muted } from "@shared/cn";
import { loadAgents } from "../../agents";
import { refreshLinks } from "../../presence";
import { LinkRow, linksProblem, unpairLink, useLinks } from "./BrowsersSection";
import { AREA, DEVICE_KINDS, linkKind, PairBrowserDialog, TRACK, type PairKind } from "./PairBrowserDialog";

const MENU_ITEM = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700";

/** "5 minutes ago", "yesterday"… in `locale`, from `iso` to `now`. */
export function ago(iso: string, now: Date, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86_400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "minute");
}

/**
 * Devices, "Your devices" (2026-11-13, the person's call): **the devices where an agent of the
 * person's runs, or has run**. **Wysebee Cloud first**, always
 * connected on the web — the page itself is served and answered by it — then each Mac paired
 * through **Wysebee Agent for Mac** (a link of kind `osx`, read from `/api/v1/browser-links`)
 * with the agent its pairing made (`LinkRow`), then each Windows PC (Wysebee Agent for Windows,
 * also `osx`, told apart by its type) and Android phone (`android`, 2026-11-16). **Pair a
 * device** offers a Mac, a Windows PC or an Android phone, each opening the browser's dialog in
 * that device's words, since the claim does not care which kind a code is; the agent it makes
 * lives in Wysebee Cloud, whose loop runs it with that device's tools. Read again every half
 * minute while shown, and after a pairing.
 * `onOpenAgent` opens the new agent's settings; a device's name opens its page (`onOpenDevice`).
 */
export function DesktopsSection({ onOpenAgent, onOpenDevice }: { onOpenAgent: (name: string) => void; onOpenDevice: (id: string) => void }) {
  const { t } = useTranslation();
  const { links, error, load } = useLinks();
  const [pairing, setPairing] = useState<PairKind | null>(null);
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const problem = linksProblem(error, t);
  const macs = links?.filter((l) => linkKind(l) !== "browser");

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2">
        <div className="flex-1 text-xs font-medium">{t("settings.desktops.heading")}</div>
        <div ref={box} className="relative">
          <button type="button" className={cn(btn, "flex items-center gap-1 px-2 py-1 text-xs")} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu} data-track="Pair a device">
            {t("settings.desktops.pair")}
            <ChevronDown size={12} aria-hidden />
          </button>
          {menu && (
            <div
              role="menu"
              aria-label={t("settings.desktops.pair")}
              className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
              onKeyDown={(e) => e.key === "Escape" && setMenu(false)}
            >
              {DEVICE_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="menuitem"
                  className={MENU_ITEM}
                  onClick={() => {
                    setMenu(false);
                    setPairing(kind);
                  }}
                  data-track={`Pair a ${TRACK[kind]}`}
                >
                  {t(`${AREA[kind]}.pair`)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className={cn(muted, "mt-0.5 mb-2 text-[11px]")}>{t("settings.desktops.hint")}</p>
      {problem && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{problem}</p>}
      <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-700 dark:border-stone-700" data-track-private>
        <li className="flex items-center gap-3 px-3 py-2">
          <Cloud size={18} className="shrink-0 text-stone-500" aria-hidden />
          <div className="min-w-0 flex-1">
            <button type="button" className="text-left text-sm font-medium underline-offset-2 hover:underline" onClick={() => onOpenDevice("cloud")} data-track="Open device">
              Wysebee Cloud
            </button>
            <div className={cn(muted, "truncate text-[11px]")}>{t("settings.desktops.cloudHint")}</div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
            <span>{t("settings.desktops.cloudConnected")}</span>
          </div>
        </li>
        {(macs ?? []).map((link) => (
          <LinkRow key={link.id} link={link} onUnpair={(l) => void unpairLink(l, t, load)} onOpen={(l) => onOpenDevice(l.id)} />
        ))}
      </ul>
      {macs === undefined ? (
        !problem && <p className={cn(muted, "mt-2 text-xs")}>{t("settings.desktops.loading")}</p>
      ) : (
        macs.length === 0 && <p className={cn(muted, "mt-2 text-xs")}>{t("settings.desktops.none")}</p>
      )}
      {pairing && (
        <PairBrowserDialog
          kind={pairing}
          onClose={() => setPairing(null)}
          onPaired={() => void Promise.all([load(), loadAgents(), refreshLinks()])}
          onOpenAgent={(name) => {
            setPairing(null);
            onOpenAgent(name);
          }}
        />
      )}
    </div>
  );
}
