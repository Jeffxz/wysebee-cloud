import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { btn, cn, errorBanner, muted, surface } from "@shared/cn";
import { cloudFetch } from "../../cloud/data";
import { cloudHost } from "../../cloud/host";

const danger = cn(btn, "border-red-300 bg-red-600 text-white hover:bg-red-700 dark:border-red-800 dark:bg-red-700 dark:text-white");

/**
 * Account → Profile → **Delete account** (2026-11-07): `DELETE /api/v1/account` (apps/cloud/account_deletion.py) lets the server's extensions
 * go first (the hosted service stops a subscription at once, with no refund), then deletes
 * everything the cloud keeps of them and their sign-in; then the page signs out. A refusal is shown in the cloud's
 * words, and nothing is deleted.
 */
export function DeleteAccountSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="max-w-2xl space-y-2 text-sm">
      <h2 className="text-base font-semibold">{t("account.delete.title")}</h2>
      <p className={muted}>{t("account.delete.help")}</p>
      <button type="button" className={cn(btn, "text-red-700 dark:text-red-300")} onClick={() => setOpen(true)}>
        {t("account.delete.title")}
      </button>
      {open && <ConfirmDeleteAccount onCancel={() => setOpen(false)} />}
    </section>
  );
}

/** What is deleted, I understand, then Delete for good. Cancel is where the focus lands. */
export function ConfirmDeleteAccount({ onCancel }: { onCancel: () => void }) {
  const { t } = useTranslation();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await cloudFetch("/api/v1/account", { method: "DELETE" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
      return;
    }
    await cloudHost.signOut();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 text-stone-900 dark:text-stone-100" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title">
      <div className={cn(surface, "w-full max-w-lg p-5 shadow-xl")}>
        <h2 id="delete-account-title" className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlert size={18} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />
          {t("account.delete.confirmTitle")}
        </h2>
        <p className="mt-2 text-sm">{t("account.delete.body")}</p>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} disabled={busy} />
          <span>{t("account.delete.understood")}</span>
        </label>
        {error && <div className={cn(errorBanner, "mt-3 text-xs")}>{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" className={btn} onClick={onCancel} disabled={busy}>
            {t("account.delete.cancel")}
          </button>
          <button type="button" className={danger} onClick={() => void remove()} disabled={busy || !understood}>
            {busy ? t("account.delete.deleting") : t("account.delete.confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
