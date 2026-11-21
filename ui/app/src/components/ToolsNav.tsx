import { useTranslation } from "react-i18next";
import { Database, Globe, HardDrive, LayoutList, type LucideIcon } from "lucide-react";
import { cn } from "@shared/cn";
import type { Tool } from "../api";
import { LIBRARY_TABS, TAB_TOOLS, type LibraryTab } from "./AgentsView/ToolCards";
import { keyOf } from "./ToolsView";

// The Agents menu's look (AgentsNav.tsx): the rail's own purple, white on it.
const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-white/85 hover:bg-white/10";
const activeRow = "bg-white/20 font-medium text-white hover:bg-white/20";
const ICON: Record<LibraryTab, LucideIcon> = { local: HardDrive, website: Globe, database: Database };

function Count({ n }: { n: number }) {
  return <span className="shrink-0 rounded-full bg-white/15 px-1.5 text-[11px] leading-5 text-white/80">{n}</span>;
}

/**
 * The Tools page's menu (2026-11-20, the person's call: like the other pages' menus), beside
 * the rail, in place of the library's tabs: **All tools** (`#/tools`), then each kind of tool —
 * Local File & Folder, Website, Database (`#/tools/<tab>`) — each with how many of the person's
 * own tools it holds, once the page has read them (ToolsView's `onLibrary`).
 */
export function ToolsNav({
  library,
  selected,
  onSelect,
}: {
  /** The person's tools; null until the page has read them. */
  library: Tool[] | null;
  /** The kind shown, or null for All tools. */
  selected: LibraryTab | null;
  onSelect: (tab: LibraryTab | null) => void;
}) {
  const { t } = useTranslation();
  // A database connection is kept with the tools but is not one the page shows: not counted.
  const inTab = (tools: Tool[], tab: LibraryTab) => tools.filter((x) => TAB_TOOLS[tab].includes(keyOf(x.kind))).length;

  return (
    <nav
      className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-0.5 self-start overflow-y-auto border-l border-white/30 bg-[#4b3283] px-2 py-3 text-white"
      aria-label={t("tools.nav.label")}
    >
      <h2 className="px-2 pb-2 text-base font-bold text-white">{t("tools.nav.title")}</h2>
      <ul className="flex flex-col gap-0.5">
        <li>
          <button type="button" className={cn(row, selected === null && activeRow)} onClick={() => onSelect(null)} aria-current={selected === null ? "page" : undefined}>
            <LayoutList size={14} className="shrink-0 text-white/80" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("tools.nav.all")}</span>
            {library && <Count n={LIBRARY_TABS.reduce((n, tab) => n + inTab(library, tab), 0)} />}
          </button>
        </li>
        {LIBRARY_TABS.map((tab) => {
          const Icon = ICON[tab];
          return (
            <li key={tab}>
              <button type="button" className={cn(row, selected === tab && activeRow)} onClick={() => onSelect(tab)} aria-current={selected === tab ? "page" : undefined} data-track={`Tool library ${tab}`}>
                <Icon size={14} className="shrink-0 text-white/80" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{t(`agents.tools.tabs.${tab}`)}</span>
                {library && <Count n={inTab(library, tab)} />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
