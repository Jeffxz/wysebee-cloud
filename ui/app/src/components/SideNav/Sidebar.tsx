import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, Bot, Ellipsis, FolderKanban, House, ListChecks, MonitorSmartphone, Moon, Settings, Sparkles, Sun, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { cn } from "@shared/cn";
import { cloudHost } from "../../cloud/host";
import { loadProfile, useProfile } from "../../profile";
import { setTheme, useTheme } from "../../theme";
import { AgentAvatar } from "../common/AgentAvatar";
import { useUnread } from "../../activity";

export type Section =
  // A dashboard of the person's agents and devices (2026-11-19).
  | "home"
  // The person's agents: a menu of them and one's settings (Home until 2026-11-19).
  | "agents"
  // What the person's AI app told them (2026-11-14): its notifications, newest first.
  | "activity"
  | "tasks"
  // The person's devices — Wysebee Cloud and their computers and phones (Settings →
  // Connections until 2026-11-04, as on the desktop).
  | "devices"
  // The person's workspaces: their documentation, kept in Wysebee Cloud (2026-11-14).
  | "workspaces"
  // The person's skills, each a folder with its SKILL.md, kept in Wysebee Cloud (2026-11-17).
  | "skills"
  // The person's tools, each given to agents from there (2026-11-15).
  | "tools"
  | "settings"
  // The person's own page, opened by their button above Settings (not a rail item).
  | "profile";

interface Props {
  active: Section;
  onSelect: (section: Section) => void;
}

interface Item {
  key: Section;
  labelKey: string;
  icon: LucideIcon;
}

// The rail: Home, the person's workspaces, cloud tasks, agents and Activity, then More (skills,
// tools and Devices), then the look, the person's button (their Profile) and Settings.
const ITEMS: Item[] = [
  // A dashboard: workspaces, agents, tasks and devices, each with a way to its page (2026-11-19).
  { key: "home", labelKey: "sideNav.items.home", icon: House },
  // The person's workspaces, each a folder of documentation in Wysebee Cloud (2026-11-14);
  // right below Home since 2026-11-19.
  { key: "workspaces", labelKey: "sideNav.items.workspaces", icon: FolderKanban },
  { key: "tasks", labelKey: "sideNav.items.tasks", icon: ListChecks },
  // Each agent's settings, picked in its menu (Home until 2026-11-19).
  { key: "agents", labelKey: "sideNav.items.agents", icon: Bot },
  // The AI app's notifications, with a badge while some are unread (under More for a day).
  { key: "activity", labelKey: "sideNav.items.activity", icon: Bell },
];

// Under More (⋯), the rail's last item since 2026-11-19 (on the rail until then).
const MORE: Item[] = [
  // The person's skills, each a folder as a workspace is, with its SKILL.md (2026-11-17).
  { key: "skills", labelKey: "sideNav.items.skills", icon: Sparkles },
  // The person's tools and the kinds they can make, each given to an agent (2026-11-15).
  { key: "tools", labelKey: "sideNav.items.tools", icon: Wrench },
  // Wysebee Cloud and the person's devices (on the rail until 2026-11-19).
  { key: "devices", labelKey: "sideNav.items.devices", icon: MonitorSmartphone },
];

// The rail is a fixed brand color (primary-500, #855cd6) — it does not adapt
// to the app's light/dark theme, the same way a colored Slack-style nav rail
// stays constant while the main content area does switch.
const itemBtn =
  "flex w-full flex-col items-center gap-1 px-1 py-2.5 text-center text-white";
// Hover feedback lives on the icon only (not the label) — a highlighted
// background plus a slight grow, via the icon's own :hover, not the button's.
const iconWrap =
  "flex h-9 w-9 items-center justify-center rounded-lg transition-transform hover:scale-110 hover:bg-white/20";
// Active state is signaled by the icon's highlighted background — text is
// white regardless, so there's no separate active text color.
const activeIconWrap = "bg-white/15";
// Two characters for the account button: the first of the first and last words
// ("Ada Lovelace" → "AL"), or the first two of a single word ("ada" → "AD").
// Characters, not UTF-16 units, so an emoji or a supplementary-plane character is
// never cut in half.
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = Array.from(words[0]);
  const picked =
    words.length > 1
      ? [first[0], Array.from(words[words.length - 1])[0]]
      : first.slice(0, 2);
  return picked.join("").toUpperCase();
}

/** Activity's unread badge. */
function Badge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white"
      aria-label={label}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Sidebar({ active, onSelect }: Props) {
  const { t } = useTranslation();
  // The person's chosen name and picture, else the account's name.
  const profile = useProfile();
  useEffect(() => loadProfile(), []);
  const unread = useUnread();
  const unreadLabel = t("sideNav.unread", { count: unread });

  const renderItem = (item: Item) => {
    const isActive = active === item.key;
    const Icon = item.icon;
    const label = t(item.labelKey);
    return (
      <li key={item.key}>
        <button
          className={itemBtn}
          onClick={() => onSelect(item.key)}
          aria-current={isActive ? "page" : undefined}
          title={label}
        >
          <span className={cn(iconWrap, "relative", isActive && activeIconWrap)}>
            <Icon size={20} aria-hidden />
            {item.key === "activity" && <Badge count={unread} label={unreadLabel} />}
          </span>
          {/* 12px, not 14: a single long word has no break opportunity, and
              overflow-y-auto above forces overflow-x to auto, so a label too wide
              for the 80px rail clips rather than spilling. */}
          <span className="text-xs leading-tight font-medium">{label}</span>
        </button>
      </li>
    );
  };

  // More: a menu beside the rail, in a portal on <body>: the rail is sticky (its own stacking
  // context, so a z-index inside it loses to the page menu beside it) and scrolls.
  const [moreAt, setMoreAt] = useState<{ top: number; left: number } | null>(null);
  const moreRef = useRef<HTMLLIElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moreAt) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!moreRef.current?.contains(target) && !menuRef.current?.contains(target)) setMoreAt(null);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreAt(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [moreAt]);
  const moreActive = MORE.some((item) => item.key === active);
  const moreLabel = t("sideNav.items.more");

  const renderMore = () => (
    <li key="more" ref={moreRef}>
      <button
        className={itemBtn}
        onClick={(e) => {
          if (moreAt) return setMoreAt(null);
          const r = e.currentTarget.getBoundingClientRect();
          setMoreAt({ top: r.top, left: r.right + 4 });
        }}
        aria-haspopup="menu"
        aria-expanded={moreAt !== null}
        aria-current={moreActive ? "page" : undefined}
        title={moreLabel}
      >
        <span className={cn(iconWrap, "relative", moreActive && activeIconWrap)}>
          <Ellipsis size={20} aria-hidden />
        </span>
        <span className="text-xs leading-tight font-medium">{moreLabel}</span>
      </button>
      {moreAt &&
        createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={moreLabel}
              className="fixed z-50 w-48 rounded-md border border-stone-200 bg-white p-1 text-stone-800 shadow-lg dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
              style={{ top: moreAt.top, left: moreAt.left }}
            >
              {MORE.map((item, i) => {
                const Icon = item.icon;
                const current = active === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="menuitem"
                    autoFocus={i === 0}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100 dark:hover:bg-stone-700",
                      current && "bg-stone-100 font-medium dark:bg-stone-700",
                    )}
                    onClick={() => {
                      setMoreAt(null);
                      onSelect(item.key);
                    }}
                  >
                    <Icon size={16} aria-hidden />
                    <span className="flex-1">{t(item.labelKey)}</span>
                  </button>
                );
              })}
            </div>,
          document.body,
        )}
    </li>
  );

  // The look, right above the person's button: a switch, dark (the default) or light. It
  // shows at once and is saved with Wysebee's settings in the cloud (theme.ts).
  const theme = useTheme();
  const dark = theme === "dark";

  const name = profile?.display_name || (cloudHost.account()?.name ?? "");
  const initial = initials(name);
  const picture = profile?.avatar ?? "";
  const profileOpen = active === "profile";

  return (
    <nav
      // 20% darker than the brand primary-500 (#855cd6 × 0.8 per channel).
      className="sticky top-0 flex h-screen w-20 shrink-0 flex-col items-center self-start overflow-y-auto bg-[#6a4aab] py-3"
      aria-label={t("sideNav.primaryNav")}
    >
      <ul className="w-full">
        {ITEMS.map(renderItem)}
        {renderMore()}
      </ul>
      <ul className="mt-auto w-full">
        <li className="flex justify-center py-2">
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label={t("sideNav.darkMode")}
            title={t(dark ? "sideNav.toLight" : "sideNav.toDark")}
            className="relative flex h-7 w-12 items-center rounded-full bg-white/15 px-1 transition-colors hover:bg-white/25"
            onClick={() =>
              void setTheme(dark ? "light" : "dark").catch((e) =>
                toast.error(t("sideNav.themeNotSaved", { error: e instanceof Error ? e.message : String(e) })),
              )
            }
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full bg-white text-[#4b3283] shadow transition-transform",
                dark && "translate-x-5",
              )}
              aria-hidden
            >
              {dark ? <Moon size={12} /> : <Sun size={12} />}
            </span>
          </button>
        </li>
        {/* The person's button: their picture, else their initials, opening their Profile.
            Their own name: kept out of click labels. */}
        <li className="flex justify-center py-2" data-track-private>
          <button
            type="button"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full text-base font-semibold text-white shadow-sm transition-colors",
              profileOpen ? "bg-white/30 ring-2 ring-white/60" : "bg-white/15 hover:bg-white/25",
              picture && "overflow-hidden p-0",
            )}
            onClick={() => onSelect("profile")}
            aria-current={profileOpen ? "page" : undefined}
            title={name}
            aria-label={name ? t("profile.open", { name }) : t("profile.title")}
          >
            {picture ? (
              <AgentAvatar avatar={picture} label={name} size={44} className="rounded-full" />
            ) : initial ? (
              <span className="text-sm">{initial}</span>
            ) : (
              <UserRound size={20} aria-hidden />
            )}
          </button>
        </li>
        {/* Settings is the rail's last thing, a round icon-only button below the person's. */}
        <li className="flex justify-center py-2">
          <button
            type="button"
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full text-white shadow-sm transition-colors",
              active === "settings" ? "bg-white/30" : "bg-white/15 hover:bg-white/25",
            )}
            onClick={() => onSelect("settings")}
            aria-current={active === "settings" ? "page" : undefined}
            title={t("sideNav.items.settings")}
            aria-label={t("sideNav.items.settings")}
          >
            <Settings size={20} aria-hidden />
          </button>
        </li>
      </ul>
    </nav>
  );
}
