import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Eye, Pencil, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Tip } from "./common/Tip";
import { btn, btnPrimary, cn, errorBanner, inputBase, loading, muted } from "@shared/cn";
import { downloadSkillFile, fetchSkillAgents, fetchSkillFile, type SkillAgent } from "../api";
import { reasonOf } from "../workspaces";
import { addSkill, loadSkills, removeFile, removeSkill, SKILL_FILE, useSkills, writeFile } from "../skills";
import { MadeBy } from "./MadeBy";
import { SkillChanges } from "./SkillChanges";
import { Preview } from "./WorkspacesView";
import { AssistantStatus, useWriteWithAi } from "./WriteWithAi";
import { dialogs } from "./common/confirm";
import { ago } from "./SettingsView/DesktopsSection";

// Whether the editor holds what is not saved, so leaving it can ask first (App.tsx).
let dirty = false;
export function hasUnsavedSkillEdits(): boolean {
  return dirty;
}

type Open = (skill: string | null, file?: string) => void;

/** Start a skill by its name: Wysebee Cloud writes it a starter SKILL.md, which opens. */
function StartSkill({ onOpen, first }: { onOpen: Open; first: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mx-auto mt-10 flex max-w-lg flex-col gap-3 rounded-lg border border-stone-200 bg-white p-6 dark:border-stone-700 dark:bg-stone-800"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        setError(null);
        addSkill(name)
          .then((s) => onOpen(s.id, SKILL_FILE))
          .catch((err) => setError(reasonOf(err)))
          .finally(() => setBusy(false));
      }}
    >
      <h2 className="text-lg font-semibold">{t(first ? "skills.start.titleFirst" : "skills.start.title")}</h2>
      <p className={cn("text-sm", muted)}>{t("skills.start.hint")}</p>
      <input
        className={inputBase}
        value={name}
        maxLength={40}
        placeholder={t("skills.start.placeholder")}
        aria-label={t("skills.start.name")}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      {error && <div className={errorBanner}>{error}</div>}
      <div>
        <button type="submit" className={btnPrimary} disabled={busy || !name.trim()} data-track="Skills start">
          {t("skills.start.create")}
        </button>
      </div>
    </form>
  );
}

/**
 * **All skills** (`#/skills`, 2026-11-20, the person's call: like All workspaces): every skill
 * with what it is for, who made it and when it last changed, each opening its overview; **Start
 * a skill** shows the form that starts one — the page itself, as it was, when there is none yet.
 */
function SkillsList({ onOpen, me }: { onOpen: Open; me: string }) {
  const { t, i18n } = useTranslation();
  const { items } = useSkills();
  const [starting, setStarting] = useState(false);

  if (items === null) return <div className={loading}>{t("skills.loading")}</div>;
  if (items.length === 0) return <StartSkill onOpen={onOpen} first />;
  const now = new Date();
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center gap-2">
        <p className={cn(muted, "flex-1 text-xs")}>{t("skills.list.intro")}</p>
        <button type="button" className={cn(btn, "flex items-center gap-1 px-2 py-1 text-xs")} onClick={() => setStarting(true)} data-track="Skills list start">
          <Plus size={12} aria-hidden />
          {t("skills.nav.add")}
        </button>
      </div>
      {starting && <StartSkill onOpen={onOpen} first={false} />}
      <ul className={cn("divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-700 dark:border-stone-700", starting && "mt-6")} data-track-private>
        {items.map((skill) => (
          <li key={skill.id}>
            <button type="button" className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-700/50" onClick={() => onOpen(skill.id)}>
              <Sparkles size={20} className="shrink-0 text-stone-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{skill.name}</span>
                {skill.description && <span className={cn(muted, "block truncate text-xs")}>{skill.description}</span>}
                <MadeBy as="span" made={skill.created_by} changed={skill.updated_by} me={me} className={cn(muted, "block truncate text-[11px]")} />
              </span>
              {skill.updated_at && <span className={cn(muted, "shrink-0 text-xs")}>{t("home.dashboard.changed", { when: ago(skill.updated_at, now, i18n.language) })}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which of the person's agents have the skill, each a link to its settings; read again when
 * the skill changes. */
function SkillAgents({ skillId, changed }: { skillId: string; changed: string | null }) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<SkillAgent[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchSkillAgents(skillId)
      .then((r) => live && setAgents(r.agents))
      .catch(() => live && setAgents([]));
    return () => {
      live = false;
    };
  }, [skillId, changed]);
  if (agents === null) return null;
  if (!agents.length) return <p className={cn("mt-2 text-sm", muted)}>{t("skills.overview.noAgents")}</p>;
  return (
    <p className="mt-2 text-sm">
      {t("skills.overview.agents")}{" "}
      {agents.map((a, i) => (
        <span key={a.id}>
          {i > 0 && ", "}
          <a className="text-violet-700 underline dark:text-violet-300" href={`#/agents/${encodeURIComponent(a.id)}/skills`}>
            {a.label}
          </a>
        </span>
      ))}
    </p>
  );
}

/** A skill with no file open: what it is for, who made it, what it holds, which agents have it. */
function Overview({ skillId, onOpen, me }: { skillId: string; onOpen: Open; me: string }) {
  const { t } = useTranslation();
  const { items } = useSkills();
  const skill = items?.find((s) => s.id === skillId);
  if (!skill) return <div className={loading}>{items === null ? t("skills.loading") : t("skills.notFound")}</div>;

  const remove = async () => {
    if (!(await dialogs.confirm(t("skills.overview.deleteConfirm", { name: skill.name }), { action: "delete" }))) return;
    try {
      await removeSkill(skillId);
      onOpen(null);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  return (
    <div data-track-private>
      <SkillChanges skillId={skillId} />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{skill.name}</h2>
          <MadeBy made={skill.created_by} changed={skill.updated_by} me={me} className={cn("mt-1 text-xs", muted)} />
        </div>
        <button type="button" className={cn(btn, "text-red-700 dark:text-red-300")} onClick={() => void remove()} data-track="Skills delete skill">
          <Trash2 size={14} aria-hidden /> {t("skills.overview.delete")}
        </button>
      </div>
      <p className="mt-4 text-sm">{skill.description}</p>
      <p className={cn("mt-2 text-sm", muted)}>{t("skills.overview.counts", { files: skill.files.length })}</p>
      <SkillAgents skillId={skillId} changed={skill.updated_at} />
      <div className="mt-4">
        <button type="button" className={btn} onClick={() => onOpen(skillId, SKILL_FILE)} data-track="Skills open card">
          <Pencil size={14} aria-hidden /> {t("skills.overview.edit")}
        </button>
      </div>
      <p className={cn("mt-4 text-sm", muted)}>{t("skills.overview.hint")}</p>
    </div>
  );
}

/** A file that is not text: its size, and a download. */
function NotText({ skillId, path }: { skillId: string; path: string }) {
  const { t } = useTranslation();
  const { items } = useSkills();
  const file = items?.find((s) => s.id === skillId)?.files.find((f) => f.path === path);
  const download = async () => {
    try {
      const blob = await downloadSkillFile(file!.id!);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop()!;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };
  return (
    <div data-track-private>
      <h2 className="font-mono text-sm">{path}</h2>
      <p className={cn("mt-3 text-sm", muted)}>{t("skills.editor.notText", { size: file?.size ?? 0 })}</p>
      {file?.id && (
        <button type="button" className={cn(btn, "mt-3")} onClick={() => void download()} data-track="Skills download file">
          <Download size={14} aria-hidden /> {t("skills.editor.download")}
        </button>
      )}
    </div>
  );
}

/** One file of a skill: its text, edited or previewed as markdown, saved to Wysebee Cloud. */
function Editor({ skillId, path, onOpen }: { skillId: string; path: string; onOpen: Open }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [binary, setBinary] = useState(false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  // Bumped when a proposed change to this file is applied: it is read again.
  const [version, setVersion] = useState(0);
  const markdown = /\.(md|markdown)$/i.test(path);

  useEffect(() => {
    let live = true;
    fetchSkillFile(skillId, path)
      .then((f) => {
        if (!live) return;
        setSaved(f.content);
        setText(f.content);
      })
      .catch((e: Error) => {
        if (!live) return;
        // Not text (a picture, an archive…): shown as a download.
        if (e.message.startsWith("HTTP 422")) setBinary(true);
        else setError(reasonOf(e));
      });
    return () => {
      live = false;
    };
  }, [skillId, path, version]);

  // Always on: the file takes Wysebee Assistant once it is loaded; the AI app making a skill
  // opens it here.
  const ai = useWriteWithAi(skillId, path, text, setText, saved !== null, {
    kind: "skills",
    onOpened: (o) => onOpen(o.skill_id, o.path),
  });
  const changed = saved !== null && text !== saved;
  useEffect(() => {
    dirty = changed;
    return () => {
      dirty = false;
    };
  }, [changed]);

  const save = async () => {
    setBusy(true);
    try {
      await writeFile(skillId, path, text);
      setSaved(text);
      toast.success(t("skills.editor.saved"));
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await dialogs.confirm(t("skills.nav.deleteFileConfirm", { name: path }), { action: "delete" }))) return;
    try {
      await removeFile(skillId, path);
      dirty = false;
      onOpen(skillId);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  if (binary) return <NotText skillId={skillId} path={path} />;
  if (error) return <div className={errorBanner}>{error}</div>;
  if (saved === null) return <div className={loading}>{t("skills.loading")}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-track-private>
      <SkillChanges skillId={skillId} onApplied={(p) => p === path && setVersion((v) => v + 1)} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <h2 className="min-w-0 shrink truncate font-mono text-sm">{path}</h2>
          <AssistantStatus ai={ai} />
        </div>
        {markdown && (
          <div className="flex rounded-md border border-stone-300 dark:border-stone-600" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "edit"} className={cn("group relative flex items-center px-2 py-1.5", mode === "edit" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("workspaces.editor.edit")} onClick={() => setMode("edit")}>
              <Pencil size={14} aria-hidden />
              <Tip text={t("workspaces.editor.edit")} />
            </button>
            <button type="button" role="tab" aria-selected={mode === "preview"} className={cn("group relative flex items-center px-2 py-1.5", mode === "preview" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("workspaces.editor.preview")} onClick={() => setMode("preview")}>
              <Eye size={14} aria-hidden />
              <Tip text={t("workspaces.editor.preview")} />
            </button>
          </div>
        )}
        <button type="button" className={cn(btnPrimary, "group relative")} disabled={!changed || busy} onClick={() => void save()} aria-label={t("workspaces.editor.save")} data-track="Skills save file">
          <Save size={14} aria-hidden />
          <Tip text={t("workspaces.editor.save")} />
        </button>
        {path !== SKILL_FILE && (
          <button type="button" className={cn(btn, "group relative")} onClick={() => void remove()} aria-label={t("workspaces.editor.delete")} data-track="Skills delete file">
            <Trash2 size={14} aria-hidden />
            <Tip text={t("workspaces.editor.delete")} />
          </button>
        )}
      </div>
      {path === SKILL_FILE && <p className={cn("mb-2 text-xs", muted)}>{t("skills.editor.cardHint")}</p>}
      {mode === "preview" ? (
        <Preview text={text} />
      ) : (
        <textarea
          className={cn(inputBase, "min-h-[60vh] flex-1 resize-none font-mono text-sm leading-relaxed")}
          value={text}
          spellCheck={markdown}
          aria-label={t("workspaces.editor.label", { name: path })}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              if (changed && !busy) void save();
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * The Skills page (2026-11-17), as Workspaces': with none chosen, all of them (SkillsList,
 * 2026-11-20); a skill, what it
 * is for; a file, its editor (SKILL.md, the skill's card, among them) with Wysebee Assistant on
 * it. The menu beside the rail (SkillsNav) lists the skills and their files.
 */
export function SkillsView({ skill, file, onOpen, currentUserEmail = "" }: { skill: string | null; file: string | null; onOpen: Open; currentUserEmail?: string }) {
  const { items, error } = useSkills();
  useEffect(() => {
    if (items === null) void loadSkills();
  }, [items]);

  if (error && items === null) return <div className={errorBanner}>{error}</div>;
  if (!skill) return <SkillsList onOpen={onOpen} me={currentUserEmail} />;
  if (!file) return <Overview skillId={skill} onOpen={onOpen} me={currentUserEmail} />;
  return <Editor key={`${skill}/${file}`} skillId={skill} path={file} onOpen={onOpen} />;
}
