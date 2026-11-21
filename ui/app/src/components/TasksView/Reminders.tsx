import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import { cn, muted, surface } from "@shared/cn";
import { cancelReminder, fetchReminders, type Reminder } from "../../api";
import { POLL_MS } from "../../reminders";

/**
 * The reminders Wysebee set that are still to come (reminders.rs), under the Tasks list:
 * each one's text and when it is due, with a way to cancel it. Read now and every
 * POLL_MS, so one just delivered leaves the list. Nothing shows while there are none.
 */
export function RemindersList() {
  const { t, i18n } = useTranslation();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetchReminders()
        .then((r) => {
          if (live) setReminders(r.reminders);
        })
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  if (reminders.length === 0) return null;

  const format = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const cancel = async (r: Reminder) => {
    setCancelling(r.id);
    try {
      await cancelReminder(r.id);
      setReminders((all) => all.filter((x) => x.id !== r.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCancelling(null);
    }
  };

  return (
    <section aria-labelledby="reminders-title" className="flex flex-col gap-2">
      <div>
        <h3 id="reminders-title" className="flex items-center gap-1.5 text-sm font-semibold">
          <Bell size={14} aria-hidden />
          {t("tasks.reminders.title")}
        </h3>
        <p className={cn(muted, "text-xs")}>{t("tasks.reminders.intro")}</p>
      </div>
      <ul className={cn(surface, "divide-y divide-stone-200 dark:divide-stone-700")} data-track-private>
        {reminders.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm">{r.text}</span>
            <span className={cn(muted, "shrink-0 text-xs")}>{format.format(new Date(r.due_at))}</span>
            <button
              type="button"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-black/5 hover:text-red-600 disabled:opacity-50 dark:hover:bg-white/10"
              onClick={() => void cancel(r)}
              disabled={cancelling !== null}
              title={t("tasks.reminders.cancel")}
              aria-label={t("tasks.reminders.cancelOne", { text: r.text })}
              data-track="Reminder cancel"
            >
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
