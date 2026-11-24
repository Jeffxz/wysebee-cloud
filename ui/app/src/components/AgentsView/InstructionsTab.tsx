import { useState } from "react";
import Markdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { cn, inputBase, muted } from "@shared/cn";

// Matches INSTRUCTIONS_MAX_LEN in apps/desktop/gateway/api/internal_services.py.
export const INSTRUCTIONS_MAX_LEN = 50_000;

/**
 * The agent's Instruction tab: markdown the owner writes, added to the agent's system
 * prompt for every chat (the Terminal, the browser extension's Terminal and its MCP server).
 *
 * Text is never finished mid-keystroke (see components/common/autoSave), so this edits
 * a draft that the page's Unsaved changes bar (or ⌘/Ctrl+S) saves. The draft is held by the panel, not here, so switching
 * tabs does not lose what was typed.
 */
export function InstructionsTab({
  saved,
  draft,
  onDraftChange,
  onSave,
  canEdit,
  kind = "agent",
}: {
  saved: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  canEdit: boolean;
  /** A task's Plan tab is this editor with its own title, help and placeholder. */
  kind?: "agent" | "task";
}) {
  const { t } = useTranslation();
  // The words that differ for a task's plan; the rest (the count) are shared.
  const words = (key: "title" | "help" | "placeholder" | "empty") =>
    kind === "task" ? `tasks.plan.${key}` : `agents.instructions.${key}`;
  const [preview, setPreview] = useState(false);
  const dirty = draft !== saved;
  const tooLong = draft.length > INSTRUCTIONS_MAX_LEN;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-stone-600 dark:text-stone-300">
            {t(words("title"))}
          </div>
          <p className={cn(muted, "mt-1 text-[11px]")}>{t(words("help"))}</p>
        </div>
        <div className="flex shrink-0 gap-1" role="tablist">
          {(
            [
              [false, "agents.instructions.write", "Instructions Write"],
              [true, "agents.instructions.preview", "Instructions Preview"],
            ] as const
          ).map(([value, label, track]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={preview === value}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                preview === value
                  ? "bg-primary-100 text-primary-800 dark:bg-primary-900/50 dark:text-primary-300"
                  : cn(muted, "hover:bg-black/5 dark:hover:bg-white/10"),
              )}
              onClick={() => setPreview(value)}
              data-track={track}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {preview ? (
        <div
          className="markdown min-h-[20rem] rounded-md border border-stone-200 p-3 dark:border-stone-700"
          data-track-private
        >
          {draft.trim() ? (
            <Markdown>{draft}</Markdown>
          ) : (
            <span className={muted}>{t(words("empty"))}</span>
          )}
        </div>
      ) : (
        <textarea
          id="agent-instructions"
          className={cn(inputBase, "min-h-[20rem] w-full resize-y font-mono text-sm")}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+S saves, as in an editor; Escape discards.
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              if (dirty && !tooLong) onSave();
            }
            if (e.key === "Escape" && dirty) onDraftChange(saved);
          }}
          placeholder={t(words("placeholder"))}
          disabled={!canEdit}
          spellCheck
          aria-label={t(words("title"))}
          data-track-private
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn(tooLong ? "text-red-600 dark:text-red-400" : muted, "text-xs")}>
          {tooLong
            ? t("agents.instructions.tooLong", { max: INSTRUCTIONS_MAX_LEN.toLocaleString() })
            : t("agents.instructions.count", { count: draft.length })}
        </span>
      </div>
    </div>
  );
}
