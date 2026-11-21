import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Trash2 } from "lucide-react";
import { loadAgents, useAgents } from "../agents";
import { AgentAvatar } from "./common/AgentAvatar";
import { BrowserNotifySwitch } from "./BrowserNotifySwitch";
import { ACTIVITY_CHANGED, deleteNotification, fetchNotifications, markNotificationsRead, type ActivityNotification } from "../api";
import { cn, errorBanner, loading as loadingCls, muted } from "@shared/cn";
import { AssistantText } from "./common/AssistantText";

/**
 * Activity (#/activity, 2026-11-14): the notifications the person's AI app sent through
 * an agent's `send_notification` (every agent has it), newest first. Opening it reads them all, so the
 * rail's badge goes; those that were new are marked New while the page is open. One that
 * comes while it is open (the change feed's `activity`) shows at once, read in turn. Each one
 * from an agent (2026-11-15: the agent whose `send_notification` sent it, or a due task's first step's)
 * shows that agent's picture and name; one from an agent since deleted, its @handle. Above the
 * list, the switch for browser notifications (BrowserNotifySwitch). Each one has a trash button
 * that deletes it at once. With `agent` (2026-11-20, its row in the menu beside the rail,
 * ActivityNav), only that agent's; `onItems` hears every list read, for the menu.
 */
export function ActivityView({ agent = null, onItems }: { agent?: string | null; onItems?: (items: ActivityNotification[]) => void } = {}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ActivityNotification[] | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const agents = useAgents();
  useEffect(() => {
    if (agents.items === null) void loadAgents();
  }, [agents.items]);
  const agentOf = (handle: string) => agents.items?.find((a) => a.name === handle);

  const load = useCallback(async () => {
    try {
      const got = await fetchNotifications();
      setItems(got.notifications);
      setError(null);
      const unread = got.notifications.filter((n) => !n.read).map((n) => n.id);
      if (unread.length > 0) {
        setFresh((before) => new Set([...before, ...unread]));
        await markNotificationsRead();
      }
      window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread: 0 } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const changed = (e: Event) => {
      if ((e as CustomEvent<{ unread: number }>).detail.unread > 0) void load();
    };
    window.addEventListener(ACTIVITY_CHANGED, changed);
    return () => window.removeEventListener(ACTIVITY_CHANGED, changed);
  }, [load]);

  useEffect(() => {
    if (items) onItems?.(items);
  }, [items, onItems]);

  const remove = async (id: string) => {
    try {
      await deleteNotification(id);
      // Shown, so read: a list is there.
      setItems((before) => (before as ActivityNotification[]).filter((n) => n.id !== id));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

  if (error && items === null) return <div className={errorBanner}>{error}</div>;
  if (items === null) return <div className={loadingCls}>{t("shell.loading")}</div>;
  const shown = agent ? items.filter((n) => n.agent === agent) : items;
  return (
    <div className="flex flex-col gap-3">
      {!agent && <BrowserNotifySwitch />}
      {error && <div className={errorBanner}>{error}</div>}
      {agent && shown.length === 0 && <p className={cn(muted, "py-8 text-center text-sm")}>{t("activity.noneFrom", { agent: agentOf(agent)?.label ?? `@${agent}` })}</p>}
      {!agent && items.length === 0 && (
        <div className="m-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <Bell size={28} className="text-stone-400" aria-hidden />
          <p className="text-sm font-medium">{t("activity.empty")}</p>
          <p className={cn(muted, "text-xs")}>{t("activity.emptyHelp")}</p>
        </div>
      )}
      <ul className="flex flex-col gap-3" aria-label={t("activity.list")} data-track-private>
        {shown.map((n) => (
          <li
            key={n.id}
            className={cn(
              "rounded-lg border px-4 py-3",
              fresh.has(n.id) ? "border-primary-300 bg-primary-50/60 dark:border-primary-700 dark:bg-primary-900/20" : "border-stone-200 dark:border-stone-700",
            )}
          >
            {n.agent && (
              <div className="mb-1.5 flex items-center gap-2">
                <AgentAvatar avatar={agentOf(n.agent)?.avatar} label={agentOf(n.agent)?.label ?? n.agent} size={22} />
                <span className="truncate text-xs font-medium">{agentOf(n.agent)?.label ?? `@${n.agent}`}</span>
              </div>
            )}
            <div className="flex items-baseline gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{n.title}</h2>
              {fresh.has(n.id) && (
                <span className="shrink-0 rounded-full bg-primary-600 px-2 text-[11px] font-semibold leading-5 text-white">{t("activity.new")}</span>
              )}
              <time className={cn(muted, "shrink-0 text-xs")} dateTime={n.created_at}>
                {when(n.created_at)}
              </time>
              <button
                type="button"
                className="shrink-0 self-center rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600 dark:hover:bg-stone-700"
                onClick={() => void remove(n.id)}
                aria-label={t("activity.delete", { title: n.title })}
                title={t("activity.delete", { title: n.title })}
                data-track="Activity delete"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
            {n.body && (
              <div className="mt-2">
                <AssistantText text={n.body} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
