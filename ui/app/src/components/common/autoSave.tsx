import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { btn, btnPrimary, cn, muted } from "@shared/cn";

/**
 * Saving without a Save button.
 *
 * Two rules, and the split between them is about when a value is *finished*:
 *
 * - A **discrete** change — a checkbox, a select, an item added to a list — is
 *   complete the moment it happens, so it writes through and toasts.
 * - **Text** is never finished mid-keystroke. It collects into a draft and is
 *   written when the author says so: a per-field ✓/✕ where a form has one or two
 *   fields, a single save bar where it has a dozen.
 *
 * Extracted from AgentConfigPanel, which is where both were worked out. Eleven
 * copies of a serialized save chain would have been eleven chances to get the
 * ordering subtly different.
 */

/**
 * Run `save` whenever `key` changes, one save at a time.
 *
 * `key` is a serialized snapshot of the values that auto-save. Serializing rather
 * than passing a dependency array is what makes this safe against React's
 * re-renders: an unrelated render produces the same string and saves nothing.
 *
 * The chain matters because these configs are replaced *whole*. Two quick toggles
 * overlapping would let the winner depend on which response landed last.
 */
export function useAutoSave(
  key: string,
  save: () => Promise<unknown>,
  { enabled = true, label: labelProp }: { enabled?: boolean; label?: string } = {},
) {
  const { t } = useTranslation();
  const label = labelProp ?? t("common.autoSave.saved");
  // Starts at the value as loaded, so the first render saves nothing.
  const saved = useRef(key);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    if (!enabled || key === saved.current) return;
    // Advanced *before* the save: a failure must not make the next unrelated
    // change re-send the failed one as well.
    saved.current = key;
    chain.current = chain.current
      .catch(() => undefined)
      .then(async () => {
        await save();
        // A fixed id, so a burst of toggles replaces rather than stacks.
        toast.success(label, { id: `autosave:${label}` });
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  /** Re-baseline without saving — for when the form is reloaded from the server. */
  const markSaved = (next: string) => {
    saved.current = next;
  };
  return { markSaved };
}

/**
 * The ✓/✕ pair beside a single text field.
 *
 * Rendered only while the field differs from what is saved, so a form at rest is
 * quiet. Enter and Escape do the same two things — see `fieldKeyDown`.
 */
export function InlineFieldActions({
  onSave,
  onCancel,
  what,
}: {
  onSave: () => void;
  onCancel: () => void;
  /** Names the field for a screen reader: "Save description". */
  what: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        className="shrink-0 rounded p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
        onClick={onSave}
        title={t("common.inlineField.save", { what })}
        aria-label={t("common.inlineField.save", { what })}
      >
        <Check size={16} aria-hidden />
      </button>
      <button
        type="button"
        className={cn(
          muted,
          "shrink-0 rounded p-1.5 transition-colors hover:bg-black/5 dark:hover:bg-white/10",
        )}
        onClick={onCancel}
        title={t("common.inlineField.discardTitle")}
        aria-label={t("common.inlineField.discard", { what })}
      >
        <X size={16} aria-hidden />
      </button>
    </>
  );
}

/** Enter saves, Escape discards. Skips Enter in a textarea, where it means newline. */
export function fieldKeyDown(onSave: () => void, onCancel: () => void) {
  return (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" && e.currentTarget.tagName !== "TEXTAREA") {
      e.preventDefault();
      onSave();
    }
    if (e.key === "Escape") onCancel();
  };
}

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
