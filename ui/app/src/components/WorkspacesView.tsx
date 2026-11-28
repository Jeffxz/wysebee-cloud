import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Code, Eye, FilePlus2, FolderKanban, FolderPlus, Globe, LayoutTemplate, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { DocumentPage } from "./PageView";
import { Tip } from "./common/Tip";
import { btn, btnPrimary, cn, errorBanner, inputBase, loading, muted } from "@shared/cn";
import { fetchWorkspaceFile } from "../api";
import {
  addFolder,
  addWorkspace,
  htmlPagePath,
  isHtmlPage,
  loadWorkspaces,
  loadTree,
  pagePath,
  reasonOf,
  removeFile,
  removeWorkspace,
  starterPage,
  useWorkspaces,
  writeFile,
} from "../workspaces";
import { splitFrontmatter, type Frontmatter } from "../frontmatter";
import { AssistantText } from "./common/AssistantText";
import { MadeBy } from "./MadeBy";
import { AssistantStatus, useWriteWithAi } from "./WriteWithAi";
import { dialogs } from "./common/confirm";
import { ago } from "./SettingsView/DesktopsSection";

// Whether the editor holds what is not saved, so leaving it can ask first (App.tsx).
let dirty = false;
export function hasUnsavedWorkspaceEdits(): boolean {
  return dirty;
}

/** A page's frontmatter in Preview: its fields as a table, each list's items as chips. */
function FrontmatterTable({ fields }: { fields: Frontmatter["fields"] }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
      <table className="w-full text-sm" aria-label={t("workspaces.editor.frontmatter")}>
        <tbody>
          {fields.map(([key, value], i) => (
            <tr key={`${key}-${i}`} className="border-b border-stone-200 last:border-b-0 dark:border-stone-700">
              <th scope="row" className="w-40 bg-stone-50 px-3 py-2 text-left align-top font-mono text-xs font-medium text-stone-500 dark:bg-stone-900/50 dark:text-stone-400">
                {key}
              </th>
              <td className="px-3 py-2 align-top text-stone-800 dark:text-stone-100">
                {Array.isArray(value) ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {value.map((item, j) => (
                      <li key={j} className="rounded-full bg-stone-500/10 px-2 py-0.5 text-xs">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  value || <span className={muted}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A frontmatter block in a shape the table does not read: shown as written, never as markdown. */
function FrontmatterRaw({ text }: { text: string }) {
  const { t } = useTranslation();
  return (
    <pre
      className="mb-4 overflow-x-auto rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700 dark:border-stone-700 dark:bg-stone-900/50 dark:text-stone-300"
      aria-label={t("workspaces.editor.frontmatter")}
    >
      {text}
    </pre>
  );
}

/** Preview: the page as markdown, its frontmatter (if any) as a table above it. */
export function Preview({ text }: { text: string }) {
  const { t } = useTranslation();
  const front = splitFrontmatter(text);
  const body = front ? front.body : text;
  return (
    <div>
      {front && (front.raw !== undefined ? <FrontmatterRaw text={front.raw} /> : <FrontmatterTable fields={front.fields} />)}
      {(body.trim() || !front) && <AssistantText document text={body || t("workspaces.editor.empty")} />}
    </div>
  );
}

/** Start a workspace by its name: its row and its folder in Wysebee Cloud. */
function StartWorkspace({ onOpen, first }: { onOpen: (workspace: string, file?: string) => void; first: boolean }) {
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
        addWorkspace(name)
          .then((p) => onOpen(p.id, "README.md"))
          .catch((err) => setError(reasonOf(err)))
          .finally(() => setBusy(false));
      }}
    >
      <h2 className="text-lg font-semibold">{t(first ? "workspaces.start.titleFirst" : "workspaces.start.title")}</h2>
      <p className={cn("text-sm", muted)}>{t("workspaces.start.hint")}</p>
      <input
        className={inputBase}
        value={name}
        maxLength={80}
        placeholder={t("workspaces.start.placeholder")}
        aria-label={t("workspaces.start.name")}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
      />
      {error && <div className={errorBanner}>{error}</div>}
      <div>
        <button type="submit" className={btnPrimary} disabled={busy || !name.trim()} data-track="Workspaces start">
          {t("workspaces.start.create")}
        </button>
      </div>
    </form>
  );
}

/**
 * **All workspaces** (`#/workspaces`, 2026-11-20, the person's call: like All agents and All
 * devices): every workspace, with who made it and when it last changed, each opening its
 * overview; **Start a workspace** shows the form that starts one — shown from the first, as it
 * was, when there is none yet or when Home's + asked for it (`start`).
 */
function WorkspacesList({ onOpen, start, me }: { onOpen: (workspace: string | null, file?: string) => void; start: boolean; me: string }) {
  const { t, i18n } = useTranslation();
  const { items } = useWorkspaces();
  const [starting, setStarting] = useState(start);
  useEffect(() => setStarting(start), [start]);

  if (items === null) return <div className={loading}>{t("workspaces.loading")}</div>;
  if (items.length === 0) return <StartWorkspace onOpen={onOpen} first />;
  const now = new Date();
  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center gap-2">
        <p className={cn(muted, "flex-1 text-xs")}>{t("workspaces.list.intro")}</p>
        <button type="button" className={cn(btn, "flex items-center gap-1 px-2 py-1 text-xs")} onClick={() => setStarting(true)} data-track="Workspaces list start">
          <Plus size={12} aria-hidden />
          {t("workspaces.nav.add")}
        </button>
      </div>
      {starting && <StartWorkspace onOpen={onOpen} first={false} />}
      <ul className={cn("divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-700 dark:border-stone-700", starting && "mt-6")} data-track-private>
        {items.map((workspace) => (
          <li key={workspace.id}>
            <button type="button" className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-700/50" onClick={() => onOpen(workspace.id)}>
              <FolderKanban size={20} className="shrink-0 text-stone-500" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{workspace.name}</span>
                <MadeBy as="span" made={workspace.created_by} changed={workspace.updated_by} me={me} className={cn(muted, "block truncate text-xs")} />
              </span>
              {workspace.updated_at && <span className={cn(muted, "shrink-0 text-xs")}>{t("home.dashboard.changed", { when: ago(workspace.updated_at, now, i18n.language) })}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small "name it" form: a new page or a new folder. */
function NameForm({ label, placeholder, onSubmit, onCancel }: { label: string; placeholder: string; onSubmit: (value: string) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-3 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.trim()) return;
        setBusy(true);
        onSubmit(value.trim())
          .catch((err) => toast.error(reasonOf(err)))
          .finally(() => setBusy(false));
      }}
    >
      <input
        className={cn(inputBase, "max-w-sm")}
        autoFocus
        value={value}
        aria-label={label}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className={btnPrimary} disabled={busy || !value.trim()}>
        {t("workspaces.overview.create")}
      </button>
      <button type="button" className={btn} onClick={onCancel}>
        {t("workspaces.overview.cancel")}
      </button>
    </form>
  );
}

/** A workspace with no file open: where it is kept, and what can be added to it. */
function Overview({ workspaceId, onOpen, me }: { workspaceId: string; onOpen: (workspace: string | null, file?: string) => void; me: string }) {
  const { t } = useTranslation();
  const { items, trees } = useWorkspaces();
  const workspace = items?.find((p) => p.id === workspaceId);
  const tree = trees[workspaceId];
  const [adding, setAdding] = useState<"document" | "page" | "folder" | null>(null);

  useEffect(() => {
    if (!tree) loadTree(workspaceId).catch((e) => toast.error(reasonOf(e)));
  }, [workspaceId, tree]);

  if (!workspace) return <div className={loading}>{items === null ? t("workspaces.loading") : t("workspaces.notFound")}</div>;

  const remove = async () => {
    if (!(await dialogs.confirm(t("workspaces.overview.deleteConfirm", { name: workspace.name }), { action: "delete" }))) return;
    try {
      await removeWorkspace(workspaceId);
      onOpen(null);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  return (
    <div data-track-private>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold">{workspace.name}</h2>
          <MadeBy made={workspace.created_by} changed={workspace.updated_by} me={me} className={cn("mt-1 text-xs", muted)} />
        </div>
        <button type="button" className={cn(btn, "text-red-700 dark:text-red-300")} onClick={() => void remove()} data-track="Workspaces delete workspace">
          <Trash2 size={14} aria-hidden /> {t("workspaces.overview.delete")}
        </button>
      </div>
      <p className={cn("mt-4 text-sm", muted)}>
        {tree ? t("workspaces.overview.counts", { files: tree.files.length, folders: tree.folders.length }) : t("workspaces.loading")}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => setAdding("document")} data-track="Workspaces new document">
          <FilePlus2 size={14} aria-hidden /> {t("workspaces.overview.newDocument")}
        </button>
        <button type="button" className={btn} onClick={() => setAdding("page")} data-track="Workspaces new page">
          <LayoutTemplate size={14} aria-hidden /> {t("workspaces.overview.newPage")}
        </button>
        <button type="button" className={btn} onClick={() => setAdding("folder")} data-track="Workspaces new folder">
          <FolderPlus size={14} aria-hidden /> {t("workspaces.overview.newFolder")}
        </button>
      </div>
      {adding === "document" && (
        <NameForm
          label={t("workspaces.overview.documentName")}
          placeholder={t("workspaces.overview.documentPlaceholder")}
          onCancel={() => setAdding(null)}
          onSubmit={async (value) => {
            const path = pagePath("", value);
            const title = path.split("/").pop()!.replace(/\.[^.]+$/, "");
            await writeFile(workspaceId, path, `# ${title}\n`);
            setAdding(null);
            onOpen(workspaceId, path);
          }}
        />
      )}
      {adding === "page" && (
        <NameForm
          label={t("workspaces.overview.pageName")}
          placeholder={t("workspaces.overview.pagePlaceholder")}
          onCancel={() => setAdding(null)}
          onSubmit={async (value) => {
            const path = htmlPagePath("", value);
            await writeFile(workspaceId, path, starterPage(path.split("/").pop()!.replace(/\.html$/i, "")));
            setAdding(null);
            onOpen(workspaceId, path);
          }}
        />
      )}
      {adding === "folder" && (
        <NameForm
          label={t("workspaces.overview.folderName")}
          placeholder={t("workspaces.overview.folderPlaceholder")}
          onCancel={() => setAdding(null)}
          onSubmit={async (value) => {
            await addFolder(workspaceId, value.replace(/^\/+|\/+$/g, ""));
            setAdding(null);
          }}
        />
      )}
    </div>
  );
}

/** One file: its text, edited or previewed as markdown, saved to Wysebee Cloud. A `.html` file
 * is a page made directly (2026-11-27): it opens on its Page, with Source to edit its HTML. */
function Editor({ workspaceId, path, onOpen, onOpenSkill }: { workspaceId: string; path: string; onOpen: (workspace: string | null, file?: string) => void; onOpenSkill?: (skill: string, file: string) => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Page: the rich HTML page the AI app made from this document (PageView.tsx).
  const html = isHtmlPage(path);
  const [mode, setMode] = useState<"edit" | "preview" | "page">(html ? "page" : "edit");
  const [busy, setBusy] = useState(false);
  // Each save of a page made directly gives it a new address: its Page reads it again.
  const [savedCount, setSavedCount] = useState(0);
  const markdown = /\.(md|markdown)$/i.test(path);

  useEffect(() => {
    let live = true;
    setSaved(null);
    setError(null);
    setMode(isHtmlPage(path) ? "page" : "edit");
    fetchWorkspaceFile(workspaceId, path)
      .then((f) => {
        if (!live) return;
        setSaved(f.content);
        setText(f.content);
      })
      .catch((e) => live && setError(reasonOf(e)));
    return () => {
      live = false;
    };
  }, [workspaceId, path]);

  // Always on: the page takes Wysebee Assistant once it is loaded.
  // The AI app making a skill opens it: the Skills page follows (2026-11-17).
  const ai = useWriteWithAi(workspaceId, path, text, setText, saved !== null, { onOpened: (o) => onOpenSkill?.(o.skill_id, o.path) });
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
      await writeFile(workspaceId, path, text);
      setSaved(text);
      setSavedCount((n) => n + 1);
      toast.success(t("workspaces.editor.saved"));
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await dialogs.confirm(t("workspaces.editor.deleteConfirm", { name: path }), { action: "delete" }))) return;
    try {
      await removeFile(workspaceId, path);
      dirty = false;
      onOpen(workspaceId);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  if (error) return <div className={errorBanner}>{error}</div>;
  if (saved === null) return <div className={loading}>{t("workspaces.loading")}</div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-track-private>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <h2 className="min-w-0 shrink truncate font-mono text-sm">{path}</h2>
          <AssistantStatus ai={ai} />
        </div>
        {html && (
          <div className="flex rounded-md border border-stone-300 dark:border-stone-600" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "page"}
              className={cn("group relative flex items-center px-2 py-1.5", mode === "page" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("pages.tab")}
              onClick={() => setMode("page")}
              data-track="Workspaces page view"
            >
              <Globe size={14} aria-hidden />
              <Tip text={t("pages.tab")} />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              className={cn("group relative flex items-center px-2 py-1.5", mode === "edit" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("workspaces.editor.source")}
              onClick={() => setMode("edit")}
              data-track="Workspaces page source"
            >
              <Code size={14} aria-hidden />
              <Tip text={t("workspaces.editor.source")} />
            </button>
          </div>
        )}
        {markdown && (
          <div className="flex rounded-md border border-stone-300 dark:border-stone-600" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "edit"}
              className={cn("group relative flex items-center px-2 py-1.5", mode === "edit" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("workspaces.editor.edit")}
              onClick={() => setMode("edit")}
            >
              <Pencil size={14} aria-hidden />
              <Tip text={t("workspaces.editor.edit")} />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "preview"}
              className={cn("group relative flex items-center px-2 py-1.5", mode === "preview" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("workspaces.editor.preview")}
              onClick={() => setMode("preview")}
            >
              <Eye size={14} aria-hidden />
              <Tip text={t("workspaces.editor.preview")} />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "page"}
              className={cn("group relative flex items-center px-2 py-1.5", mode === "page" && "bg-stone-200 dark:bg-stone-700")}
              aria-label={t("pages.tab")}
              onClick={() => setMode("page")}
              data-track="Workspaces page view"
            >
              <Globe size={14} aria-hidden />
              <Tip text={t("pages.tab")} />
            </button>
          </div>
        )}
        <button type="button" className={cn(btnPrimary, "group relative")} disabled={!changed || busy} onClick={() => void save()} aria-label={t("workspaces.editor.save")} data-track="Workspaces save file">
          <Save size={14} aria-hidden />
          <Tip text={t("workspaces.editor.save")} />
        </button>
        <button type="button" className={cn(btn, "group relative")} onClick={() => void remove()} aria-label={t("workspaces.editor.delete")} data-track="Workspaces delete file">
          <Trash2 size={14} aria-hidden />
          <Tip text={t("workspaces.editor.delete")} />
        </button>
      </div>
      {mode === "page" ? (
        <>
          {html && changed && <p className={cn(muted, "mb-2 text-xs")}>{t("pages.unsaved")}</p>}
          <DocumentPage key={savedCount} workspaceId={workspaceId} path={path} direct={html} />
        </>
      ) : mode === "preview" ? (
        <Preview text={text} />
      ) : (
        <textarea
          className={cn(inputBase, "min-h-[60vh] flex-1 resize-none font-mono text-sm leading-relaxed")}
          value={text}
          spellCheck={!html}
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
 * The Workspaces page (2026-11-14): with none chosen, all of them (WorkspacesList, 2026-11-20);
 * a workspace, where it is
 * kept and adding a page or a folder; a file, its editor. The menu beside the rail
 * (WorkspacesNav) lists the workspaces and their folder structure.
 */
export function WorkspacesView({
  workspace,
  file,
  start = false,
  onOpen,
  onOpenSkill,
  currentUserEmail = "",
}: {
  workspace: string | null;
  file: string | null;
  /** With none chosen: show the form that starts one (Home's +). */
  start?: boolean;
  onOpen: (workspace: string | null, file?: string) => void;
  /** Where to go when the AI app makes a skill while a page is open here. */
  onOpenSkill?: (skill: string, file: string) => void;
  /** The signed-in person's email: they are "you" in who made and changed a workspace. */
  currentUserEmail?: string;
}) {
  const { items, error } = useWorkspaces();
  useEffect(() => {
    if (items === null) void loadWorkspaces();
  }, [items]);

  if (error && items === null) return <div className={errorBanner}>{error}</div>;
  if (!workspace) return <WorkspacesList onOpen={onOpen} start={start} me={currentUserEmail} />;
  if (!file) return <Overview workspaceId={workspace} onOpen={onOpen} me={currentUserEmail} />;
  return <Editor key={`${workspace}/${file}`} workspaceId={workspace} path={file} onOpen={onOpen} onOpenSkill={onOpenSkill} />;
}
