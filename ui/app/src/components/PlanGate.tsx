import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Toaster } from "sonner";
import { btn, cn, muted } from "@shared/cn";
import { fetchPlan } from "../api";
import { billingEnabled, canSignOut } from "../cloud/auth";
import { cloudHost } from "../cloud/host";
import { SUBSCRIPTION_REQUIRED } from "../cloud/paywall";
import { useOnReturn } from "../onReturn";
import { useTheme } from "../theme";
import { BillingTab, RETRY_MS } from "./ProfileView/BillingTab";

/** Where a person without a plan is sent: Account → Billing. */
export const BILLING_HASH = "#/account/billing";

type Gate = "checking" | "open" | "closed";

/**
 * **The plan, before the app**, where the server serves plans (an extension's
 * `features.billing`, cloud/auth.ts). The signed-in person's plan is read first
 * (`GET /api/v1/plan`); while they may not use the cloud (`allowed` false) the app is not
 * shown at all — none of its pages read anything — only Account → Billing, where they
 * subscribe. A 402 `subscription_required` from any request later (cloud/paywall.ts: the plan
 * ended meanwhile) reads the plan again. Back from paying (the window regains focus, and once
 * more a few seconds later, since the payment provider's word may arrive just after the person
 * does) the plan is read again, and the app opens without a reload, on Billing. A plan that
 * cannot be read opens the app: the server refuses what the person may not do anyway. A server
 * without plans is never gated, and the plan is never asked for.
 */
export function PlanGate({ children }: { children: ReactNode }) {
  const hosted = billingEnabled();
  const [gate, setGate] = useState<Gate>(hosted ? "checking" : "open");

  const check = useCallback(() => {
    if (!hosted) return;
    fetchPlan().then(
      (p) => setGate(p.allowed ? "open" : "closed"),
      () => setGate((g) => (g === "checking" ? "open" : g)),
    );
  }, [hosted]);
  useEffect(check, [check]);

  useEffect(() => {
    if (!hosted) return;
    const onRefused = () => {
      setGate("closed");
      check();
    };
    window.addEventListener(SUBSCRIPTION_REQUIRED, onRefused);
    return () => window.removeEventListener(SUBSCRIPTION_REQUIRED, onRefused);
  }, [hosted, check]);

  const closed = gate === "closed";
  useOnReturn(
    useCallback(() => {
      if (!closed) return;
      check();
      window.setTimeout(check, RETRY_MS);
    }, [closed, check]),
  );

  // Billing is where the person is, and where they stay once their plan opens the app.
  useEffect(() => {
    if (closed && window.location.hash !== BILLING_HASH) window.history.replaceState(null, "", BILLING_HASH);
  }, [closed]);

  if (gate === "checking") return null;
  if (closed) return <Paywall />;
  return <>{children}</>;
}

/** What a person without a plan sees: why, Billing (the plans, Subscribe), and Sign out. */
function Paywall() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6">
      <Toaster theme={theme} richColors position="top-right" closeButton />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-700">
        <div className="min-w-0 space-y-1">
          <h1 className="text-lg font-semibold">{t("profile.paywall.title")}</h1>
          <p className={cn(muted, "max-w-2xl text-sm")}>{t("profile.paywall.body")}</p>
        </div>
        {canSignOut() && (
          <button
            type="button"
            className={cn(btn, "shrink-0")}
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void cloudHost.signOut();
            }}
          >
            {t("account.signOut")}
          </button>
        )}
      </div>
      <BillingTab />
    </div>
  );
}
