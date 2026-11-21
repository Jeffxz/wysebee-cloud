import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted, surface } from "@shared/cn";
import { MAX_ARGS, type LocalProgramArg } from "../../cloud/localPrograms";

/**
 * The pieces of the "Run local program" dialog (LocalProgramDialog) — and its modal:
 * the tool's name and description, and the arguments, each fixed text or a
 * blank Wysebee fills in.
 */

/** The modal: a title, an intro line, the fields, the problem if any, Cancel and save.
 * Escape, Cancel or a click outside close it. */
export function ProgramModal({
  title,
  intro,
  saveLabel,
  problem,
  onSave,
  onClose,
  track,
  children,
}: {
  title: string;
  intro: string;
  saveLabel: string;
  problem: string | null;
  onSave: () => void;
  onClose: () => void;
  /** The save button's `data-track`. */
  track: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(surface, "flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto p-5 shadow-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className={cn(muted, "text-xs")}>{intro}</p>
        {children}
        {problem && <div className={cn(errorBanner, "mb-0 text-xs")}>{problem}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("agents.tools.local.cancel")}
          </button>
          <button type="button" className={btnPrimary} onClick={onSave} data-track={track}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The tool's name (what Wysebee calls it) and what it does (how Wysebee knows when). */
export function NameFields({
  idPrefix,
  name,
  onName,
  description,
  onDescription,
}: {
  idPrefix: string;
  name: string;
  onName: (name: string) => void;
  description: string;
  onDescription: (description: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${idPrefix}-name`} className="font-medium">
          {t("agents.tools.local.name")}
        </label>
        <input id={`${idPrefix}-name`} className={cn(inputBase, "font-mono")} value={name} onChange={(e) => onName(e.target.value)} placeholder="git_status" autoFocus />
        <span className={cn(muted, "text-[11px]")}>{t("agents.tools.local.nameHint")}</span>
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${idPrefix}-description`} className="font-medium">
          {t("agents.tools.local.description")}
        </label>
        <textarea id={`${idPrefix}-description`} className={cn(inputBase, "min-h-[60px]")} value={description} onChange={(e) => onDescription(e.target.value)} />
        <span className={cn(muted, "text-[11px]")}>{t("agents.tools.local.descriptionHint")}</span>
      </div>
    </>
  );
}

/** The arguments, in order, and a preview of what runs. */
export function ArgsEditor({
  command,
  args,
  onArgs,
  track,
}: {
  command: string;
  args: LocalProgramArg[];
  onArgs: (update: (all: LocalProgramArg[]) => LocalProgramArg[]) => void;
  /** The add button's `data-track`. */
  track: string;
}) {
  const { t } = useTranslation();
  const setArg = (i: number, next: LocalProgramArg) => onArgs((all) => all.map((a, j) => (j === i ? next : a)));
  const preview = [command.trim() || "…", ...args.map((a) => ("param" in a ? `<${a.param || "…"}>` : a.value))].join(" ");
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{t("agents.tools.local.args")}</span>
      {args.length === 0 && <p className={cn(muted, "text-xs")}>{t("agents.tools.local.noArgs")}</p>}
      {args.map((a, i) => {
        const blank = "param" in a;
        return (
          <div key={i} className="flex items-start gap-2" role="group" aria-label={t("agents.tools.local.arg", { n: i + 1 })}>
            <select
              className={cn(inputBase, "w-40 shrink-0")}
              value={blank ? "param" : "value"}
              onChange={(e) => setArg(i, e.target.value === "param" ? { param: "", description: "" } : { value: "" })}
              aria-label={t("agents.tools.local.argKind")}
            >
              <option value="value">{t("agents.tools.local.fixed")}</option>
              <option value="param">{t("agents.tools.local.blank")}</option>
            </select>
            {blank ? (
              <div className="flex flex-1 flex-col gap-1">
                <input
                  className={cn(inputBase, "font-mono")}
                  value={a.param}
                  onChange={(e) => setArg(i, { param: e.target.value, description: a.description })}
                  placeholder={t("agents.tools.local.blankName")}
                  aria-label={t("agents.tools.local.blankName")}
                />
                <input
                  className={inputBase}
                  value={a.description}
                  onChange={(e) => setArg(i, { param: a.param, description: e.target.value })}
                  placeholder={t("agents.tools.local.blankDescription")}
                  aria-label={t("agents.tools.local.blankDescription")}
                />
              </div>
            ) : (
              <input
                className={cn(inputBase, "flex-1 font-mono")}
                value={a.value}
                onChange={(e) => setArg(i, { value: e.target.value })}
                placeholder="--verbose"
                aria-label={t("agents.tools.local.fixedValue")}
              />
            )}
            <button
              type="button"
              className="mt-1.5 shrink-0 rounded p-1 text-stone-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              onClick={() => onArgs((all) => all.filter((_, j) => j !== i))}
              aria-label={t("agents.tools.local.removeArg", { n: i + 1 })}
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className={cn(btn, "inline-flex w-fit items-center gap-1")}
        onClick={() => onArgs((all) => [...all, { value: "" }])}
        disabled={args.length >= MAX_ARGS}
        data-track={track}
      >
        <Plus size={14} aria-hidden />
        {t("agents.tools.local.addArg")}
      </button>
      <p className={cn(muted, "text-[11px]")}>{t("agents.tools.local.argsHint")}</p>
      <code className="block overflow-x-auto rounded bg-black/5 px-2 py-1 font-mono text-xs dark:bg-white/10" aria-label={t("agents.tools.local.preview")}>
        {preview}
      </code>
    </div>
  );
}
