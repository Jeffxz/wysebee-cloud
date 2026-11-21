import { useTranslation } from "react-i18next";
import { cn, muted } from "@shared/cn";
import type { PlanStatus } from "../../api";
import { formatBytes } from "./StorageUsage";

/** How full a meter is, 0–100 (past the limit is a full bar; no limit, an empty one). */
export function percentOf(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : used > 0 ? 100 : 0;
}

/** One line of the plan's usage: what it says, and a bar towards the limit — amber from 80%,
 * red at the limit. */
function Meter({ label, text, used, limit }: { label: string; text: string; used: number; limit: number }) {
  const percent = percentOf(used, limit);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{text}</span>
        <span className={cn(muted, "text-xs")}>{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-2 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-primary-600")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * What the person's plan gives and how much of it they use (`GET /api/v1/plan`): devices
 * paired against the plan's, devices online now against how many may be at once, and this
 * month's relay traffic — what passes between their AI app and their devices through Wysebee
 * Cloud — against the month's allowance, with the day it starts over (the 1st, UTC). Nothing
 * without a plan.
 */
export function PlanUsage({ status }: { status: PlanStatus }) {
  const { t, i18n } = useTranslation();
  const { limits, usage } = status;
  if (!limits) return null;
  const number = (n: number) => n.toLocaleString(i18n.language);
  const size = (n: number) => formatBytes(n, i18n.language);
  const resets = new Date(usage.resets_at).toLocaleDateString(i18n.language, { month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <section className="max-w-2xl" aria-label={t("profile.usage.title")}>
      <h2 className="mb-4 text-base font-semibold">{t("profile.usage.title")}</h2>
      <div className="space-y-4 rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-700">
        <Meter
          label={t("profile.usage.devicesLabel")}
          text={t("profile.usage.devices", { used: number(usage.devices), limit: number(limits.devices) })}
          used={usage.devices}
          limit={limits.devices}
        />
        <Meter
          label={t("profile.usage.onlineLabel")}
          text={t("profile.usage.online", { used: number(usage.online), limit: number(limits.online) })}
          used={usage.online}
          limit={limits.online}
        />
        <Meter
          label={t("profile.usage.relayLabel")}
          text={t("profile.usage.relay", { used: size(usage.relay_bytes), limit: size(limits.relay_bytes) })}
          used={usage.relay_bytes}
          limit={limits.relay_bytes}
        />
        <p className={cn(muted, "text-xs")}>{t("profile.usage.relayWhat", { date: resets })}</p>
      </div>
    </section>
  );
}
