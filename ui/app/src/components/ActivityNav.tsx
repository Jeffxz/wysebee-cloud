import { useTranslation } from "react-i18next";
import { LayoutList } from "lucide-react";
import { cn } from "@shared/cn";
import { useAgents } from "../agents";
import type { ActivityNotification } from "../api";
import { AgentAvatar } from "./common/AgentAvatar";

// The Agents menu's look (AgentsNav.tsx): the rail's own purple, white on it.
const row = "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-white/85 hover:bg-white/10";
const activeRow = "bg-white/20 font-medium text-white hover:bg-white/20";

function Count({ n }: { n: number }) {
  return <span className="shrink-0 rounded-full bg-white/15 px-1.5 text-[11px] leading-5 text-white/80">{n}</span>;
}

/**
 * The Activity page's menu (2026-11-20, the person's call: like the other pages' menus), beside
 * the rail: **All activity** (`#/activity`), then each agent that has sent the person a
 * notification — Wysebee first, then by name; one since deleted by its @handle — with how many,
 * each showing only its own (`#/activity/<handle>`). The notifications are the ones the page
 * read (ActivityView's `onItems`); none until then.
 */
export function ActivityNav({
  items,
  selected,
  onSelect,
}: {
  /** The notifications shown on the page; null until read. */
  items: ActivityNotification[] | null;
  /** The agent whose notifications are shown, by handle; null for all of them. */
  selected: string | null;
  onSelect: (agent: string | null) => void;
}) {
  const { t } = useTranslation();
  const agents = useAgents();

  const counts = new Map<string, number>();
  for (const n of items ?? []) if (n.agent) counts.set(n.agent, (counts.get(n.agent) ?? 0) + 1);
  // The agents' own order (Wysebee first, then by label), then any no longer there.
  const known = (agents.items ?? []).filter((a) => counts.has(a.name));
  const gone = [...counts.keys()].filter((h) => !known.some((a) => a.name === h)).sort();

  const item = (handle: string, avatar: string | undefined, label: string) => (
    <li key={handle}>
      <button type="button" className={cn(row, selected === handle && activeRow)} onClick={() => onSelect(handle)} aria-current={selected === handle ? "page" : undefined}>
        <AgentAvatar avatar={avatar} label={label} size={20} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Count n={counts.get(handle)!} />
      </button>
    </li>
  );

  return (
    <nav
      className="sticky top-0 flex h-screen w-60 shrink-0 flex-col gap-0.5 self-start overflow-y-auto border-l border-white/30 bg-[#4b3283] px-2 py-3 text-white"
      aria-label={t("activity.nav.label")}
    >
      <h2 className="px-2 pb-2 text-base font-bold text-white">{t("activity.nav.title")}</h2>
      <ul className="flex flex-col gap-0.5" data-track-private>
        <li>
          <button type="button" className={cn(row, selected === null && activeRow)} onClick={() => onSelect(null)} aria-current={selected === null ? "page" : undefined}>
            <LayoutList size={14} className="shrink-0 text-white/80" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t("activity.nav.all")}</span>
            {items && <Count n={items.length} />}
          </button>
        </li>
        {known.map((a) => item(a.name, a.avatar, a.label))}
        {gone.map((h) => item(h, undefined, `@${h}`))}
      </ul>
    </nav>
  );
}
