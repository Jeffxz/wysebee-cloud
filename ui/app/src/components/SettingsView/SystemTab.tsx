import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, errorBanner, muted } from "@shared/cn";
import { fetchUsageAnalytics, setUsageAnalytics } from "../../api";
import { setTelemetryEnabled } from "../../telemetry";

/**
 * Settings → System on the web (2026-10-31): **Send usage analytics** — it follows the person
 * (`telemetry_enabled`). Off, this page sends nothing more at once (telemetry.ts).
 */
export function SystemTab() {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsageAnalytics().then(
      (s) => setOn(s.telemetry_enabled),
      (e: Error) => setError(e.message),
    );
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await setUsageAnalytics(next);
      setOn(saved.telemetry_enabled);
      setTelemetryEnabled(saved.telemetry_enabled);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      {error && <div className={cn(errorBanner, "text-xs")}>{error}</div>}
      <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">{t("settings.system.analytics.title")}</div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={on ?? false} disabled={on === null || saving} onChange={(e) => void toggle(e.target.checked)} data-track="Usage analytics" />
        <span>
          {t("settings.system.analytics.send")}
          <span className={cn(muted, "block text-xs")}>{t("settings.system.analytics.help")}</span>
        </span>
      </label>
    </div>
  );
}
