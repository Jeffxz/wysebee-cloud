import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { btn, btnPrimary, cn, muted } from "@shared/cn";

/**
 * Saving with an Unsaved changes bar.
 *
 * Text is never finished mid-keystroke, so a form collects its edits into a draft and
 * writes them when the person says so: one save bar for the whole form. `hasUnsavedEdits`
 * tells the rest of the page whether such a form is open with changes.
 */

/** How many SaveBars are showing — forms with unsaved changes. Counted so a change
 * made on another device (App.tsx) does not reload an editor out from under someone. */
let unsavedEditors = 0;

/** Whether some open form has unsaved changes. */
export function hasUnsavedEdits(): boolean {
  return unsavedEditors > 0;
}

/**
 * One save/discard bar for a form with too many text fields to badge each one.
 *
 * The alternative was a ✓/✕ on every input — around twenty pairs on the HTTP
 * Request form once its header, query and parameter rows are counted, which is
 * worse than the single button it replaces. Appears only while something is
 * unsaved, so the form is still buttonless at rest.
 */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  note,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Extra context, e.g. what a discrete change already persisted. */
  note?: string;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!dirty) return;
    unsavedEditors += 1;
    return () => {
      unsavedEditors -= 1;
    };
  }, [dirty]);
  if (!dirty) return null;
  return (
    // Floating at the top of the window, over the page rather than in it: it never
    // pushes the form down when it appears, and it is in view wherever the form is
    // scrolled. A portal, so no scrolling or transformed ancestor can clip or move it.
    createPortal(
    <div
      role="status"
      className="fixed top-3 left-1/2 z-50 flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-50/95 px-3 py-2 shadow-lg backdrop-blur dark:bg-amber-950/80"
    >
      <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
        {t("common.saveBar.unsaved")}
      </span>
      {note && <span className={cn(muted, "text-[11px]")}>{note}</span>}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" className={btn} onClick={onDiscard} disabled={saving}>
          {t("common.saveBar.discard")}
        </button>
        <button
          type="button"
          className={btnPrimary}
          onClick={onSave}
          disabled={saving}
        >
          {saving ? t("common.saveBar.saving") : t("common.saveBar.save")}
        </button>
      </div>
    </div>,
    document.body,
    )
  );
}
