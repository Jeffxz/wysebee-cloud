import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Globe, Lock } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, muted, surface } from "@shared/cn";
import { sharePage, unsharePage, type PageShare } from "../api";
import { reasonOf } from "../workspaces";
import { Copyable } from "./common/Copyable";

type Choice = "private" | "public";

/**
 * Who sees a page the AI app made (2026-11-25, the person's call): only its owner, or anyone
 * with its link — no sign-in (apps/cloud/workspace_pages.py, `/s/<key>`). Friends and
 * colleagues are to come. A choice is saved as soon as it is made.
 */
export function PageShareDialog({
  pageId,
  share,
  onChange,
  onClose,
}: {
  pageId: string;
  share: PageShare | null;
  onChange: (share: PageShare | null) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const now: Choice = share?.audience === "public" ? "public" : "private";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only an unchecked radio fires, and none while a choice is saving (they are disabled).
  const choose = async (choice: Choice) => {
    setBusy(true);
    setProblem(null);
    try {
      if (choice === "public") onChange(await sharePage(pageId, "public"));
      else {
        await unsharePage(pageId);
        onChange(null);
      }
    } catch (e) {
      setProblem(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const options: { value: Choice; icon: typeof Lock; label: string; hint: string }[] = [
    { value: "private", icon: Lock, label: t("pages.share.private"), hint: t("pages.share.privateHint") },
    { value: "public", icon: Globe, label: t("pages.share.public"), hint: t("pages.share.publicHint") },
  ];

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 text-stone-900 dark:text-stone-100" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("pages.share.title")}
        className={cn(surface, "flex w-full max-w-md flex-col gap-4 p-5 shadow-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{t("pages.share.title")}</h2>
        <div role="radiogroup" aria-label={t("pages.share.who")} className="flex flex-col gap-2">
          {options.map(({ value, icon: Icon, label, hint }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
                now === value ? "border-primary-600 bg-primary-600/5" : "border-stone-200 hover:border-stone-400 dark:border-stone-700 dark:hover:border-stone-500",
                busy && "cursor-wait opacity-70",
              )}
            >
              <input
                type="radio"
                name="page-share"
                className="mt-1"
                checked={now === value}
                disabled={busy}
                onChange={() => void choose(value)}
              />
              <Icon size={16} aria-hidden className="mt-0.5 shrink-0" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{label}</span>
                <span className={cn(muted, "text-xs")}>{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {problem && <div className={errorBanner}>{problem}</div>}
        {share && (
          <div className="flex flex-col gap-2">
            <Copyable value={share.url} label={t("pages.share.link")} />
            <p className={cn(muted, "text-xs")}>{t("pages.share.live")}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          {share && (
            <a className={btn} href={share.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden /> {t("pages.share.openLink")}
            </a>
          )}
          <button type="button" className={btnPrimary} onClick={onClose}>
            {t("pages.share.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
