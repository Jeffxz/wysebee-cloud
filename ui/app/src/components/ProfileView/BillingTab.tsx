import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Settings2, Sparkles } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, muted } from "@shared/cn";
import { fetchBilling, fetchPlan, type Billing, type Plan, type PlanStatus, type Subscription } from "../../api";
import { useOnReturn } from "../../onReturn";
import { PlanUsage } from "./PlanUsage";
import { StorageUsage, formatBytes } from "./StorageUsage";

/** How long after the person comes back the page reads once more. */
export const RETRY_MS = 5000;

/** An amount in the currency's smallest unit, as money in the page's language: 2000 usd → "$20.00". */
export function money(amount: number, currency: string, language: string): string {
  const code = currency.toUpperCase();
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits as number;
    return new Intl.NumberFormat(language, { style: "currency", currency: code }).format(amount / 10 ** digits);
  } catch {
    return `${(amount / 100).toFixed(2)} ${code}`;
  }
}

/** What the subscription line says: renews, ends, a payment being retried — or nothing
 * to say of one that no longer gives its plan (the offer to subscribe shows instead). */
export function subscriptionLine(sub: Subscription | null): { key: string; withDate: boolean } | null {
  if (!sub?.active) return null;
  if (sub.status === "past_due") return { key: "profile.billing.pastDue", withDate: false };
  if (!sub.current_period_end) return { key: "profile.billing.activeNoDate", withDate: false };
  return { key: sub.cancel_at_period_end ? "profile.billing.ending" : "profile.billing.active", withDate: true };
}

/**
 * Account → **Billing**, where the server serves plans (an extension's `features.billing`,
 * cloud/auth.ts): the person's plan and how much of it they use — devices paired and online,
 * this month's relay traffic, their file storage — then the **plans** as the server lists them
 * (`GET /api/v1/billing`: names, prices, what each gives), each with **Subscribe** while the
 * person has none, the one they are on marked — **Manage subscription** (the payment
 * provider's customer portal: switch plan, cancel, change the card) once they have one, and
 * their payments (date, amount, status). It is the one page a person without a plan can open
 * (components/PlanGate.tsx). The payment provider brings the person back here after paying;
 * the page reads again whenever they come back to it, and once more a few seconds later,
 * since its word may arrive just after they do.
 */
export function BillingTab() {
  const { t, i18n } = useTranslation();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchBilling().then(
      (b) => (setBilling(b), setError(null)),
      (e: Error) => setError(e.message),
    );
    // Usage is shown when it can be read; Billing works without it.
    fetchPlan().then(setStatus, () => {});
  }, []);
  useEffect(load, [load]);
  useOnReturn(
    useCallback(() => {
      load();
      window.setTimeout(load, RETRY_MS);
    }, [load]),
  );

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, { year: "numeric", month: "short", day: "numeric" });
  const manage = billing?.manage_url ? (
    <a href={billing.manage_url} className={cn(btn, "inline-flex shrink-0 items-center gap-1.5")} data-track="manage-subscription">
      <Settings2 size={14} aria-hidden />
      {t("profile.billing.manage")}
    </a>
  ) : null;
  const line = billing ? subscriptionLine(billing.subscription) : null;
  const sub = billing?.subscription;
  const subscribed = !!sub?.active;
  const offered = billing?.plans.some((p) => p.buy_url) ?? false;
  // A plan's name is the server's (each plan's `name`); one it no longer lists is "paid".
  const planName = (id: string | null | undefined) => billing?.plans.find((p) => p.id === id)?.name ?? t("profile.billing.paidPlan");

  return (
    <div className="max-w-3xl space-y-8">
      {(line || manage) && (
        <div className="flex max-w-2xl flex-wrap items-center justify-between gap-3">
          {line && sub ? (
            <p className={cn(muted, "text-sm", sub.status === "past_due" && "text-amber-700 dark:text-amber-400")}>
              {t(line.key, { plan: planName(sub.plan), date: line.withDate ? date(sub.current_period_end as string) : "" })}
            </p>
          ) : (
            <span />
          )}
          {manage}
        </div>
      )}

      {status?.limits && (
        <>
          <PlanUsage status={status} />
          <StorageUsage />
        </>
      )}

      {billing && (
        <section aria-label={t("profile.billing.plans")}>
          <h2 className="mb-4 text-base font-semibold">{t("profile.billing.plans")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {billing.plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} current={billing.current === plan.id} />
            ))}
          </div>
          {subscribed ? (
            billing.manage_url && <p className={cn(muted, "mt-3 text-xs")}>{t("profile.billing.switchHint")}</p>
          ) : (
            !offered && <p className={cn(muted, "mt-3 text-xs")}>{t("profile.billing.unavailable")}</p>
          )}
        </section>
      )}

      <section aria-label={t("profile.billing.history")}>
        <h2 className="mb-4 text-base font-semibold">{t("profile.billing.history")}</h2>
        {error && <div className={cn(errorBanner, "text-xs")}>{error}</div>}
        {billing && billing.purchases.length === 0 && <p className={cn(muted, "text-sm")}>{t("profile.billing.none")}</p>}
        {billing && billing.purchases.length > 0 && (
          <table className="w-full text-left text-sm" data-track-private>
            <thead className={cn(muted, "text-xs")}>
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="py-2 font-medium">{t("profile.billing.date")}</th>
                <th className="py-2 text-right font-medium">{t("profile.billing.amount")}</th>
                <th className="py-2 pl-4 font-medium">{t("profile.billing.status")}</th>
              </tr>
            </thead>
            <tbody>
              {billing.purchases.map((p) => (
                <tr key={p.id} className="border-b border-stone-100 dark:border-stone-800">
                  <td className="py-2">{date(p.created_at)}</td>
                  <td className="py-2 text-right tabular-nums">{money(p.amount, p.currency, i18n.language)}</td>
                  <td
                    className={cn(
                      "py-2 pl-4",
                      p.status === "paid" ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {t(`profile.billing.${p.status}`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** One plan: its name, price, devices, relay traffic and file storage; "Current plan" on the
 * one the person is on, else Subscribe when it can be chosen. */
function PlanCard({ plan, current }: { plan: Plan; current: boolean }) {
  const { t, i18n } = useTranslation();
  const number = (n: number) => n.toLocaleString(i18n.language);
  const size = (n: number) => formatBytes(n, i18n.language);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-4 text-sm",
        current ? "border-primary-500 ring-1 ring-primary-500 dark:border-primary-400 dark:ring-primary-400" : "border-stone-200 dark:border-stone-700",
      )}
      data-testid={`plan-${plan.id}`}
    >
      <div className="font-semibold">{plan.name}</div>
      <div className="text-lg font-semibold">{t("profile.billing.perMonth", { price: money(plan.amount, plan.currency, i18n.language) })}</div>
      <ul className={cn(muted, "flex-1 space-y-1 text-xs")}>
        <li>{t("profile.billing.planDevices", { devices: number(plan.devices), online: number(plan.online) })}</li>
        <li>{t("profile.billing.planRelay", { size: size(plan.relay_bytes) })}</li>
        {!!plan.storage && <li>{t("profile.billing.planStorage", { size: size(plan.storage) })}</li>}
      </ul>
      {current ? (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 dark:text-primary-300">
          <Check size={14} aria-hidden />
          {t("profile.billing.current")}
        </span>
      ) : (
        plan.buy_url && (
          <a href={plan.buy_url} className={cn(btnPrimary, "inline-flex items-center justify-center gap-1.5")} data-track={`subscribe-${plan.id}`}>
            <Sparkles size={14} aria-hidden />
            {t("profile.billing.subscribe")}
          </a>
        )
      )}
    </div>
  );
}
