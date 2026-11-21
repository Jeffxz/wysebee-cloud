import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Check, Eye, EyeOff, Sparkles, X } from "lucide-react";
import { btn, btnPrimary, cn, muted } from "@shared/cn";
import { discardSkillChange, fetchSkillChange, fetchSkillChanges, type SkillChange } from "../api";
import { reasonOf } from "../workspaces";
import { applyChange } from "../skills";

/** How often the skill's waiting changes are read again while its page shows: the AI app
 * proposes them from elsewhere. */
export const CHANGES_REFRESH_MS = 5000;

const PRE = "max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-stone-200 bg-stone-50 p-2 font-mono text-xs dark:border-stone-700 dark:bg-stone-900";

/** One change: what it is, its text beside the file's now when viewed, Apply and Discard. */
function Row({ skillId, change, onDone }: { skillId: string; change: SkillChange; onDone: (applied: boolean) => void }) {
  const { t } = useTranslation();
  const [shown, setShown] = useState<{ content: string | null; current: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const kind = change.folder ? "folder" : change.new ? "newFile" : "changedFile";
  const act = async (work: () => Promise<unknown>, applied: boolean) => {
    setBusy(true);
    try {
      await work();
      onDone(applied);
    } catch (e) {
      toast.error(reasonOf(e));
      setBusy(false);
    }
  };
  const view = async () => {
    if (shown) return setShown(null);
    try {
      setShown(await fetchSkillChange(skillId, change.id));
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 dark:border-violet-900 dark:bg-stone-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{change.path}</span>
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 dark:bg-violet-900 dark:text-violet-100">{t(`skills.changes.kind.${kind}`)}</span>
        {!change.folder && (
          <button type="button" className={cn(btn, "text-xs")} onClick={() => void view()} aria-expanded={!!shown} data-track="Skill change view">
            {shown ? <EyeOff size={13} aria-hidden /> : <Eye size={13} aria-hidden />} {t(shown ? "skills.changes.hide" : "skills.changes.view")}
          </button>
        )}
        <button type="button" className={cn(btnPrimary, "text-xs")} disabled={busy} onClick={() => void act(() => applyChange(skillId, change.id), true)} aria-label={t("skills.changes.applyOne", { path: change.path })} data-track="Skill change apply">
          <Check size={13} aria-hidden /> {t("skills.changes.apply")}
        </button>
        <button type="button" className={cn(btn, "text-xs")} disabled={busy} onClick={() => void act(() => discardSkillChange(skillId, change.id), false)} aria-label={t("skills.changes.discardOne", { path: change.path })} data-track="Skill change discard">
          <X size={13} aria-hidden /> {t("skills.changes.discard")}
        </button>
      </div>
      {shown && (
        <div className={cn("grid gap-2", shown.current !== null && "md:grid-cols-2")}>
          {shown.current !== null && (
            <div>
              <p className={cn(muted, "mb-1 text-xs")}>{t("skills.changes.now")}</p>
              <pre className={PRE}>{shown.current}</pre>
            </div>
          )}
          <div>
            <p className={cn(muted, "mb-1 text-xs")}>{t("skills.changes.proposed")}</p>
            <pre className={PRE}>{shown.content}</pre>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Changes the person's AI app proposed for this skill (apps/cloud/skill_changes.py): **AI apps
 * propose, the person approves** (docs/ai-apps-propose.md). None is in the skill until applied
 * here; each can be viewed beside the file as it is now. Read again every few seconds, since
 * the AI app proposes from elsewhere; nothing shows when none waits. `onApplied`: a file was
 * saved into the skill (the editor open on it reads it again).
 */
export function SkillChanges({ skillId, onApplied }: { skillId: string; onApplied?: (path: string) => void }) {
  const { t } = useTranslation();
  const [changes, setChanges] = useState<SkillChange[]>([]);
  const load = useCallback(
    () =>
      fetchSkillChanges(skillId).then(
        (r) => setChanges(r.changes),
        () => {},
      ),
    [skillId],
  );
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), CHANGES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  if (changes.length === 0) return null;
  const applyAll = async () => {
    for (const c of changes) {
      try {
        await applyChange(skillId, c.id);
        onApplied?.(c.path);
      } catch (e) {
        toast.error(reasonOf(e));
        break;
      }
    }
    await load();
  };
  return (
    <section aria-label={t("skills.changes.title")} className="mb-4 flex flex-col gap-2 rounded-xl border border-violet-300 bg-violet-50 p-3 dark:border-violet-800 dark:bg-violet-950/40" data-track-private>
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles size={16} className="text-violet-700 dark:text-violet-300" aria-hidden />
        <h3 className="min-w-0 flex-1 text-sm font-semibold text-violet-900 dark:text-violet-100">{t("skills.changes.title")}</h3>
        {changes.length > 1 && (
          <button type="button" className={cn(btn, "text-xs")} onClick={() => void applyAll()} data-track="Skill changes apply all">
            {t("skills.changes.applyAll", { count: changes.length })}
          </button>
        )}
      </div>
      <p className="text-xs text-violet-900 dark:text-violet-100">{t("skills.changes.note")}</p>
      <ul className="flex flex-col gap-2">
        {changes.map((c) => (
          <Row
            key={c.id}
            skillId={skillId}
            change={c}
            onDone={(applied) => {
              if (applied) onApplied?.(c.path);
              void load();
            }}
          />
        ))}
      </ul>
    </section>
  );
}
