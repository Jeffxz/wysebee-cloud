import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Pencil, Plus } from "lucide-react";
import { btn, cn, errorBanner, loading as loadingCls, muted } from "@shared/cn";
import { APP_CHANGED, fetchAgentSkills, fetchSkills, setAgentSkills, type WebSkill } from "../../api";

/** Open the Skills page (2026-11-17): a skill's, or the page to start one. */
function goToSkills(id?: string): void {
  window.location.hash = id ? `/skills/${encodeURIComponent(id)}` : "/skills";
}

const ICON_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700";

/** The skills library and the agent's own skills' ids, read on opening and again when the app's
 * data changes. */
function useSkills(agentId: string): { skills: WebSkill[] | null; attached: string[]; setAttached: (ids: string[]) => void; error: string | null } {
  const [skills, setSkills] = useState<WebSkill[] | null>(null);
  const [attached, setAttached] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all([fetchSkills(), fetchAgentSkills(agentId)])
        .then(
          ([library, mine]) => ({ skills: library.skills, attached: mine.skills.map((s) => s.id), error: null }),
          (e: Error) => ({ skills: undefined, attached: undefined, error: e.message }),
        )
        .then((next) => {
          if (!live) return;
          if (next.skills) setSkills(next.skills);
          if (next.attached) setAttached(next.attached);
          setError(next.error);
        });
    void load();
    window.addEventListener(APP_CHANGED, load);
    return () => {
      live = false;
      window.removeEventListener(APP_CHANGED, load);
    };
  }, [agentId]);
  return { skills, attached, setAttached, error };
}

/**
 * An agent's **Skills** on the web: the skills library kept in the person's account in Wysebee
 * Cloud, each with a tick — the agent has it. A tick is **saved at once** (Wysebee Cloud's
 * agent_skills, by the skill's id: 2026-11-15), not with the settings' Save, so a skill renamed
 * stays the agent's.
 *
 * **Skills are made and changed on the Skills page** (2026-11-17): **New skill** and each
 * skill's pencil open it, where a skill is a folder — its SKILL.md and its scripts — edited as
 * a workspace is, whence a Mac agent's Mac gets it.
 */
export function SkillsTab({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { skills, attached, setAttached, error } = useSkills(agentId);
  const [problem, setProblem] = useState<string | null>(null);
  const give = async (ids: string[]) => {
    setProblem(null);
    try {
      const saved = await setAgentSkills(agentId, ids);
      setAttached(saved.skills.map((s) => s.id));
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  const toggle = (id: string) => void give(attached.includes(id) ? attached.filter((i) => i !== id) : [...attached, id]);
  return (
    <div className="flex flex-col gap-3">
      <p className={cn(muted, "text-sm")}>{t("agents.skills.tabIntro")}</p>
      {canEdit && (
        <button type="button" className={cn(btn, "self-start")} onClick={() => goToSkills()} data-track="Skill new">
          <Plus size={14} aria-hidden />
          {t("agents.skills.new")}
        </button>
      )}
      {error && <div className={cn(errorBanner, "mb-0")}>{error}</div>}
      {problem && <div className={cn(errorBanner, "mb-0")}>{problem}</div>}
      {!skills && !error && <div className={loadingCls}>{t("shell.loading")}</div>}
      {skills && skills.length === 0 && <p className={cn(muted, "text-sm")}>{t("agents.skills.empty")}</p>}
      <ul className="flex flex-col gap-1" data-track-private>
        {(skills ?? []).map((s) => (
          <li key={s.id} className="flex items-center gap-1">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800/60">
              <input type="checkbox" checked={attached.includes(s.id)} onChange={() => toggle(s.id)} disabled={!canEdit} aria-label={t("agents.skills.give", { name: s.name })} />
              <BookOpen size={18} className="shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className={cn(muted, "block truncate text-xs")}>{s.description}</span>
              </span>
            </label>
            {canEdit && (
              <button type="button" className={ICON_BUTTON} onClick={() => goToSkills(s.id)} aria-label={t("agents.skills.edit", { name: s.name })} title={t("agents.skills.edit", { name: s.name })} data-track="Skill edit">
                <Pencil size={15} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
