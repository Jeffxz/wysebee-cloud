import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, errorBanner, muted } from "@shared/cn";
import { fetchStorage, type Storage } from "../../api";
import { useOnReturn } from "../../onReturn";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** A size for people: `1.5 MB`, `812 KB`, `0 B` — in steps of 1024, one decimal under 10 of a
 * unit past bytes, the number written the language's way. */
export function formatBytes(bytes: number, language?: string): string {
  let n = Math.max(0, bytes);
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  const digits = unit > 0 && n < 10 ? 1 : 0;
  return `${n.toLocaleString(language, { maximumFractionDigits: digits })} ${UNITS[unit]}`;
}

/** How full the storage is, 0–100, for the bar (past the quota is a full bar). */
export function percentStored(s: Pick<Storage, "used" | "limit">): number {
  return s.limit > 0 ? Math.min(100, Math.round((s.used / s.limit) * 100)) : 100;
}

/** The kinds of file the cloud counts, as the page names them (any other is not listed). */
const KINDS = ["assets", "skill_files"];

/**
 * The person's **storage** (2026-11-11) — on Billing, under their plan's usage, and on a
 * self-hosted server's Profile page: the
 * files Wysebee Cloud keeps for them in blob storage (`/api/v1/account/storage`,
 * cloud/credits.ts) — their pictures and their skills' files — as a bar towards the storage quota, with what each kind takes. Amber
 * from 80%, red at the quota; shown, not enforced. Read when the page opens and again
 * whenever the person comes back to the page.
 */
export function StorageUsage() {
  const { t, i18n } = useTranslation();
  const [storage, setStorage] = useState<Storage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchStorage().then(
      (s) => (setStorage(s), setError(null)),
      (e: Error) => setError(e.message),
    );
  }, []);
  useEffect(load, [load]);
  useOnReturn(load);

  const size = (n: number) => formatBytes(n, i18n.language);
  const percent = storage ? percentStored(storage) : 0;
  const parts = (storage?.parts ?? []).filter((p) => p.bytes > 0 && KINDS.includes(p.kind));
  return (
    <section className="max-w-2xl" aria-label={t("profile.storage.title")}>
      <h2 className="mb-4 text-base font-semibold">{t("profile.storage.title")}</h2>
      {error && <div className={cn(errorBanner, "text-xs")}>{error}</div>}
      {storage && (
        <div className="space-y-2 rounded-lg border border-stone-200 p-4 text-sm dark:border-stone-700">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-medium">{t("profile.storage.used", { used: size(storage.used), limit: size(storage.limit) })}</span>
            <span className={cn(muted, "text-xs")}>{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={t("profile.storage.title")}
            aria-valuemin={0}
            aria-valuemax={storage.limit}
            aria-valuenow={Math.min(storage.used, storage.limit)}
            className="h-2.5 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
          >
            <div
              className={cn("h-full rounded-full transition-[width]", percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-primary-600")}
              style={{ width: `${percent}%` }}
            />
          </div>
          {parts.length > 0 && (
            <ul className={cn(muted, "flex flex-wrap gap-x-4 gap-y-1 text-xs")}>
              {parts.map((p) => (
                <li key={p.kind}>
                  {t(`profile.storage.kinds.${p.kind}`)}: {size(p.bytes)}
                </li>
              ))}
            </ul>
          )}
          <p className={cn(muted, "text-xs")}>{t("profile.storage.what")}</p>
        </div>
      )}
    </section>
  );
}
