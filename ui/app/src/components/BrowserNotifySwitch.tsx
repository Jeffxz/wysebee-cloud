import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { cn, muted } from "@shared/cn";
import { browserNotifyOn, browserNotifySupported, turnOffBrowserNotify, turnOnBrowserNotify } from "../browserNotify";

/** Activity's switch for browser notifications (browserNotify.ts): on asks the browser first;
 * blocked there, it says where to allow them. Nothing where the browser has none. */
export function BrowserNotifySwitch() {
  const { t } = useTranslation();
  const [on, setOn] = useState(browserNotifyOn);
  const [blocked, setBlocked] = useState(() => browserNotifySupported() && Notification.permission === "denied");
  if (!browserNotifySupported()) return null;

  const toggle = async () => {
    if (on) {
      turnOffBrowserNotify();
      setOn(false);
      return;
    }
    const permission = await turnOnBrowserNotify();
    setOn(permission === "granted");
    setBlocked(permission === "denied");
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-stone-200 px-4 py-2.5 dark:border-stone-700">
      <BellRing size={18} className="shrink-0 text-stone-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t("activity.browser.title")}</div>
        <p className={cn(muted, "text-xs")}>{blocked ? t("activity.browser.blocked") : t("activity.browser.help")}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={t("activity.browser.title")}
        disabled={blocked}
        onClick={() => void toggle()}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50",
          on ? "bg-primary-600" : "bg-stone-300 dark:bg-stone-600",
        )}
        data-track="Activity browser notifications"
      >
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
      </button>
    </div>
  );
}
