import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LayoutList } from "lucide-react";
import { cn } from "@shared/cn";
import type { BrowserLink } from "../api";
import { useLinks } from "../presence";
import { DeviceIcon, type DeviceKind } from "./common/DeviceIcon";
import { linkKind, type PairKind } from "./SettingsView/PairBrowserDialog";

// The Agents menu's look (AgentsNav.tsx): the rail's own purple, white on it.
const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-white/85 hover:bg-white/10";
const activeRow = "bg-white/20 font-medium text-white hover:bg-white/20";

/** The id Wysebee Cloud is opened by in the menu and the address (`#/devices/cloud`). */
export const CLOUD_DEVICE = "cloud";

/** How a paired link's kind shows as a device. */
export const LINK_DEVICE: Record<PairKind, DeviceKind> = { browser: "chrome", osx: "mac", windows: "windows", linux: "linux", android: "android" };

/** Whether `link`'s device is reached now: connected and not paused. */
export function linkOnline(link: BrowserLink): boolean {
  return link.status === "connected" && !link.paused;
}

/**
 * The Devices page's menu (2026-11-20, the person's call: like Agents'), beside the rail:
 * **All devices** (the list, `#/devices`), **Wysebee Cloud**, each device an agent of the
 * person's runs on, then the **browsers** paired with the Wysebee Agent extension — each
 * opening that device's page (`#/devices/<id>`), with a dot for whether it is reached now.
 * The links are the ones presence reads (presence.ts), again every 30 s.
 */
export function DevicesNav({ selected, onSelect }: { selected: string | null; onSelect: (device: string | null) => void }) {
  const { t } = useTranslation();
  const links = useLinks();
  const devices = links?.filter((l) => linkKind(l) !== "browser") ?? [];
  const browsers = links?.filter((l) => linkKind(l) === "browser") ?? [];

  const item = (id: string, icon: ReactNode, label: string, online: boolean) => (
    <li key={id}>
      <button type="button" className={cn(row, selected === id && activeRow)} onClick={() => onSelect(id)} aria-current={selected === id ? "page" : undefined}>
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", online ? "bg-green-400" : "bg-white/40")}
          role="img"
          aria-label={t(online ? "devices.nav.online" : "devices.nav.offline")}
        />
      </button>
    </li>
  );
  const linkItem = (link: BrowserLink) => {
    const kind = LINK_DEVICE[linkKind(link)];
    return item(link.id, <DeviceIcon name={link.agent_type?.name ?? link.browser} kind={kind} size={14} tone="text-white/80" />, link.label, linkOnline(link));
  };

  return (
    <nav
      className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-0.5 self-start overflow-y-auto border-l border-white/30 bg-[#4b3283] px-2 py-3 text-white"
      aria-label={t("devices.nav.label")}
    >
      <h2 className="px-2 pb-2 text-base font-bold text-white">{t("devices.nav.title")}</h2>
      <ul className="flex flex-col gap-0.5" data-track-private>
        <li>
          <button type="button" className={cn(row, selected === null && activeRow)} onClick={() => onSelect(null)} aria-current={selected === null ? "page" : undefined}>
            <LayoutList size={14} className="shrink-0 text-white/80" aria-hidden />
            <span className="truncate">{t("devices.nav.all")}</span>
          </button>
        </li>
        {item(CLOUD_DEVICE, <DeviceIcon name="Wysebee Cloud" kind="cloud" size={14} tone="text-white/80" />, "Wysebee Cloud", true)}
        {devices.map(linkItem)}
      </ul>
      {browsers.length > 0 && (
        <>
          <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("devices.nav.browsers")}</div>
          <ul className="flex flex-col gap-0.5" data-track-private>
            {browsers.map(linkItem)}
          </ul>
        </>
      )}
    </nav>
  );
}
