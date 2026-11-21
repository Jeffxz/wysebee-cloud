import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted } from "@shared/cn";
import type { SiteKind, SiteLink } from "../../api";
import { MAX_SITES, siteProblemOf } from "./sites";

const EMPTY: SiteLink = { description: "", address: "" };

/**
 * A site tool's links on the web — Open Gmail, Open Calendar, Travel, News or Website
 * (`kind`): each link with what it is for, as many as the person uses (+ Add another; a
 * trash on each). Saved at once as the person's link tools, given to the agent (ToolCards).
 */
export function SiteDialog({ kind, initial, onSave, onClose }: { kind: SiteKind; initial: SiteLink[]; onSave: (links: SiteLink[]) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const k = (key: string, values?: Record<string, unknown>) => t(`agents.tools.${kind}.${key}`, values);
  const s = (key: string, values?: Record<string, unknown>) => t(`agents.tools.sites.${key}`, values);
  const editing = initial.length > 0;
  const [links, setLinks] = useState<SiteLink[]>(editing ? initial : [EMPTY]);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const change = (i: number, field: keyof SiteLink, value: string) => setLinks((all) => all.map((a, j) => (j === i ? { ...a, [field]: value } : a)));
  const save = () => {
    const clean = links.map((a) => ({ description: a.description.trim(), address: a.address.trim() }));
    const wrong = siteProblemOf(kind, clean);
    if (wrong) return setProblem(t(wrong.key, { item: k("item", { n: wrong.n }) }));
    onSave(clean);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={k(editing ? "editTitle" : "addTitle")} className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-stone-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{k(editing ? "editTitle" : "addTitle")}</h2>
        <p className={cn(muted, "text-xs")}>{k("intro")}</p>
        <div className="flex flex-col gap-3" data-track-private>
          {links.map((a, i) => (
            <fieldset key={i} className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <legend className="flex items-center gap-1 px-1 text-xs font-semibold text-stone-500 dark:text-stone-400">
                {k("item", { n: i + 1 })}
                {links.length > 1 && (
                  <button type="button" className="rounded p-0.5 hover:text-red-600" onClick={() => setLinks((all) => all.filter((_, j) => j !== i))} aria-label={s("remove", { item: k("item", { n: i + 1 }) })}>
                    <Trash2 size={12} aria-hidden />
                  </button>
                )}
              </legend>
              <label htmlFor={`site-link-${i}`} className="text-sm font-medium">
                {s("link")}
              </label>
              <input id={`site-link-${i}`} className={inputBase} value={a.address} onChange={(e) => change(i, "address", e.target.value)} placeholder={k("linkPlaceholder")} />
              <label htmlFor={`site-description-${i}`} className="text-sm font-medium">
                {s("description")}
              </label>
              <textarea id={`site-description-${i}`} className={cn(inputBase, "min-h-[50px]")} value={a.description} onChange={(e) => change(i, "description", e.target.value)} placeholder={k("descriptionPlaceholder")} />
            </fieldset>
          ))}
          <span className={cn(muted, "text-[11px]")}>{k("linkHint")}</span>
          <button type="button" className={cn(btn, "self-start text-xs")} onClick={() => setLinks((all) => [...all, EMPTY])} disabled={links.length >= MAX_SITES}>
            <Plus size={13} aria-hidden />
            {k("addAnother")}
          </button>
        </div>
        {problem && <div className={cn(errorBanner, "mb-0 text-xs")}>{problem}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>
            {t("agents.tools.close")}
          </button>
          <button type="button" className={btnPrimary} onClick={save}>
            {t("home.web.done")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
