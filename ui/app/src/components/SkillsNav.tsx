import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, LayoutList, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { cn } from "@shared/cn";
import { buildTree, pagePath, reasonOf, type TreeNode } from "../workspaces";
import { addFolder, addSkill, loadSkills, removeFile, removeFolder, renameSkill, SKILL_FILE, treeOf, upload, useSkills, writeFile } from "../skills";
import { dialogs } from "./common/confirm";

// Workspaces' menu's look (WorkspacesNav.tsx): the rail's own purple, white on it.
const row = "flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-white/85 hover:bg-white/10";
const activeRow = "bg-white/20 font-medium text-white hover:bg-white/20";
const hoverBtn = "absolute top-1/2 -translate-y-1/2 rounded p-1 text-white/75 opacity-0 hover:bg-white/20 hover:text-white focus:opacity-100";
const nameInput =
  "min-w-0 flex-1 rounded border border-white/30 bg-white/15 px-1.5 py-0.5 text-sm text-white outline-none placeholder:text-white/55 focus:ring-2 focus:ring-white/40";
const menuItem = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-700";

/** What is being added inside a folder ("" the skill's own), named in the menu. */
interface AddingIn {
  skill: string;
  folder: string;
  kind: "file" | "folder";
}

/**
 * The Skills menu beside the rail (2026-11-17), as Workspaces': a **Skills** header with a +
 * that starts one (named here, it opens on its SKILL.md), **All skills** (their list, `#/skills`,
 * 2026-11-20 — like the other pages' menus), then each of the person's skills,
 * opening into its files and folders. On hover, a skill's pencil renames it; its + and each
 * folder's add a file, a folder or **files uploaded from the computer** (scripts, references…)
 * inside it; a folder's and a file's trash delete them — never SKILL.md, the skill's card.
 */
export function SkillsNav({
  selectedSkill,
  selectedFile,
  onSelect,
}: {
  selectedSkill: string | null;
  selectedFile: string | null;
  onSelect: (skill: string | null, file?: string) => void;
}) {
  const { t } = useTranslation();
  const { items, error } = useSkills();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // The + menu open ("<skill>/<folder>"), and what is being named in one.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<AddingIn | null>(null);
  const [childName, setChildName] = useState("");
  // The skill being renamed, and the name typed.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  // Which skills and folders are open: "<skill>" or "<skill>/<folder path>".
  const [open, setOpen] = useState<Set<string>>(() => new Set(selectedSkill ? [selectedSkill] : []));
  // Where files chosen on the computer go.
  const uploadTo = useRef<{ skill: string; folder: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadSkills();
  }, []);

  // A + menu closes on a click anywhere outside it (or its +).
  useEffect(() => {
    if (!menuFor) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest("[data-skill-menu]")) setMenuFor(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  // The skill shown is open.
  useEffect(() => {
    if (selectedSkill) setOpen((prev) => new Set(prev).add(selectedSkill));
  }, [selectedSkill]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  // A skill not shown (or shown with a file open) opens onto its overview; the one already
  // shown folds away or out.
  const openSkill = (id: string) => {
    if (selectedSkill !== id || selectedFile) {
      setOpen((prev) => new Set(prev).add(id));
      onSelect(id);
      return;
    }
    toggle(id);
  };

  const create = async () => {
    const value = name.trim();
    if (!value) {
      setAdding(false);
      return;
    }
    setBusy(true);
    try {
      const skill = await addSkill(value);
      setAdding(false);
      setName("");
      onSelect(skill.id, SKILL_FILE);
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (id: string, before: string) => {
    const value = newName.trim();
    if (!value || value === before) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await renameSkill(id, value);
      setRenaming(null);
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const startAdding = (skill: string, folder: string, kind: AddingIn["kind"]) => {
    setMenuFor(null);
    setChildName("");
    setAddingIn({ skill, folder, kind });
    setOpen((prev) => new Set(prev).add(folder ? `${skill}/${folder}` : skill));
  };

  const startUpload = (skill: string, folder: string) => {
    setMenuFor(null);
    uploadTo.current = { skill, folder };
    picker.current!.click();
  };

  const uploaded = async (files: File[]) => {
    const to = uploadTo.current;
    if (!to || files.length === 0) return;
    setBusy(true);
    try {
      await upload(to.skill, to.folder, files);
      setOpen((prev) => new Set(prev).add(to.folder ? `${to.skill}/${to.folder}` : to.skill));
      toast.success(t("skills.nav.uploaded", { n: files.length }));
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const addInFolder = async () => {
    const value = childName.trim().replace(/^\/+|\/+$/g, "");
    if (!addingIn || !value) {
      setAddingIn(null);
      return;
    }
    const { skill, folder, kind } = addingIn;
    setBusy(true);
    try {
      if (kind === "file") {
        const path = pagePath(folder, value);
        const title = path.split("/").pop()!.replace(/\.[^.]+$/, "");
        await writeFile(skill, path, /\.(md|markdown)$/i.test(path) ? `# ${title}\n` : "\n");
        setAddingIn(null);
        onSelect(skill, path);
      } else {
        const path = folder ? `${folder}/${value}` : value;
        await addFolder(skill, path);
        setAddingIn(null);
        setOpen((prev) => new Set(prev).add(`${skill}/${path}`));
      }
    } catch (e) {
      toast.error(reasonOf(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (skill: string, path: string) => {
    if (!(await dialogs.confirm(t("skills.nav.deleteFolderConfirm", { name: path }), { action: "delete" }))) return;
    try {
      await removeFolder(skill, path);
      if (selectedSkill === skill && selectedFile?.startsWith(path + "/")) onSelect(skill);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  const deleteFile = async (skill: string, path: string) => {
    if (!(await dialogs.confirm(t("skills.nav.deleteFileConfirm", { name: path }), { action: "delete" }))) return;
    try {
      await removeFile(skill, path);
      if (selectedSkill === skill && selectedFile === path) onSelect(skill);
    } catch (e) {
      toast.error(reasonOf(e));
    }
  };

  /** The + menu of a folder ("" the skill's own). */
  const addMenu = (skill: string, folder: string, key: string, label: string) => (
    <div
      role="menu"
      data-skill-menu
      aria-label={label}
      className="absolute right-1 top-full z-20 mt-1 w-44 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
      onKeyDown={(e) => {
        if (e.key === "Escape") setMenuFor(null);
      }}
      key={`${key}-menu`}
    >
      <button type="button" role="menuitem" className={menuItem} autoFocus onClick={() => startAdding(skill, folder, "file")} data-track="Skills new file">
        <FilePlus2 size={14} aria-hidden /> {t("skills.nav.newFile")}
      </button>
      <button type="button" role="menuitem" className={menuItem} onClick={() => startAdding(skill, folder, "folder")} data-track="Skills new folder">
        <FolderPlus size={14} aria-hidden /> {t("skills.nav.newFolder")}
      </button>
      <button type="button" role="menuitem" className={menuItem} onClick={() => startUpload(skill, folder)} data-track="Skills upload">
        <Upload size={14} aria-hidden /> {t("skills.nav.upload")}
      </button>
    </div>
  );

  const plusButton = (skill: string, folder: string, key: string, label: string, group: string) => {
    const menuOpen = menuFor === key;
    return (
      <>
        <button
          type="button"
          className={cn(hoverBtn, "right-7", group, menuOpen && "bg-white/20 opacity-100")}
          onClick={() => setMenuFor(menuOpen ? null : key)}
          data-skill-menu
          aria-label={label}
          title={label}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-track="Skills add in folder"
        >
          <Plus size={13} aria-hidden />
        </button>
        {menuOpen && addMenu(skill, folder, key, label)}
      </>
    );
  };

  /** The form naming a new file or folder, inside the folder it goes in. */
  const namingForm = (naming: AddingIn, depth: number) => (
    <li>
      <form
        className="flex items-center gap-1.5 py-0.5 pr-2"
        style={{ paddingLeft: `${0.5 + depth * 0.85}rem` }}
        onSubmit={(e) => {
          e.preventDefault();
          void addInFolder();
        }}
      >
        {naming.kind === "file" ? <FileText size={14} className="shrink-0 text-white/70" aria-hidden /> : <Folder size={14} className="shrink-0 text-white/70" aria-hidden />}
        <input
          className={nameInput}
          autoFocus
          value={childName}
          maxLength={120}
          placeholder={t(naming.kind === "file" ? "skills.nav.fileName" : "skills.nav.folderName")}
          aria-label={t(naming.kind === "file" ? "skills.nav.fileName" : "skills.nav.folderName")}
          disabled={busy}
          onChange={(e) => setChildName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAddingIn(null);
          }}
          onBlur={() => {
            if (!childName.trim() && !busy) setAddingIn(null);
          }}
        />
      </form>
    </li>
  );

  const renderNodes = (skill: string, nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const key = `${skill}/${node.path}`;
      const indent = { paddingLeft: `${0.5 + depth * 0.85}rem` };
      if (node.kind === "file") {
        const active = selectedSkill === skill && selectedFile === node.path;
        return (
          <li key={key} className="group/file relative">
            <button
              type="button"
              className={cn(row, "pr-8", active && activeRow)}
              style={indent}
              onClick={() => onSelect(skill, node.path)}
              aria-current={active ? "page" : undefined}
            >
              <FileText size={14} className="shrink-0 opacity-70" aria-hidden />
              <span className="truncate">{node.name}</span>
            </button>
            {node.path !== SKILL_FILE && (
              <button
                type="button"
                className={cn(hoverBtn, "right-1 group-hover/file:opacity-100")}
                onClick={() => void deleteFile(skill, node.path)}
                aria-label={t("skills.nav.deleteFile", { name: node.path })}
                title={t("skills.nav.deleteFile", { name: node.path })}
                data-track="Skills delete file"
              >
                <Trash2 size={13} aria-hidden />
              </button>
            )}
          </li>
        );
      }
      const expanded = open.has(key);
      const naming = addingIn?.skill === skill && addingIn.folder === node.path ? addingIn : null;
      return (
        <li key={key} className="group/folder relative">
          <div className="relative">
            <button type="button" className={cn(row, "pr-14")} style={indent} onClick={() => toggle(key)} aria-expanded={expanded}>
              <ChevronRight size={14} className={cn("shrink-0 transition-transform", expanded && "rotate-90")} aria-hidden />
              {expanded ? <FolderOpen size={14} className="shrink-0 opacity-70" aria-hidden /> : <Folder size={14} className="shrink-0 opacity-70" aria-hidden />}
              <span className="truncate">{node.name}</span>
            </button>
            {plusButton(skill, node.path, key, t("skills.nav.addIn", { name: node.path }), "group-hover/folder:opacity-100")}
            <button
              type="button"
              className={cn(hoverBtn, "right-1 group-hover/folder:opacity-100")}
              onClick={() => void deleteFolder(skill, node.path)}
              aria-label={t("skills.nav.deleteFolder", { name: node.path })}
              title={t("skills.nav.deleteFolder", { name: node.path })}
              data-track="Skills delete folder"
            >
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
          {expanded && (
            <ul className="flex flex-col gap-0.5">
              {naming && namingForm(naming, depth + 1)}
              {renderNodes(skill, node.children, depth + 1)}
            </ul>
          )}
        </li>
      );
    });

  return (
    <nav
      className="sticky top-0 flex h-screen w-64 shrink-0 flex-col gap-0.5 self-start overflow-y-auto border-l border-white/30 bg-[#4b3283] px-2 py-3 text-white"
      aria-label={t("skills.nav.label")}
    >
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        data-testid="skill-upload"
        onChange={(e) => {
          const files = Array.from(e.target.files!);
          e.target.value = "";
          void uploaded(files);
        }}
      />
      <div className="flex items-center pb-2">
        <h2 className="flex-1 px-2 text-base font-bold text-white">{t("skills.nav.title")}</h2>
        <button
          type="button"
          className="rounded p-1 text-white/80 hover:bg-white/20 hover:text-white"
          onClick={() => {
            setName("");
            setAdding(true);
          }}
          aria-label={t("skills.nav.add")}
          title={t("skills.nav.add")}
          data-track="Skills add"
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <ul className="flex flex-col gap-0.5" data-track-private>
        <li>
          <button type="button" className={cn(row, selectedSkill === null && activeRow)} onClick={() => onSelect(null)} aria-current={selectedSkill === null ? "page" : undefined}>
            <LayoutList size={14} className="shrink-0 opacity-80" aria-hidden />
            <span className="truncate">{t("skills.nav.all")}</span>
          </button>
        </li>
        {error && <li className="px-2 text-xs text-red-100">{error}</li>}
        {items === null && !error && <li className="px-2 text-xs text-white/70">{t("skills.nav.loading")}</li>}
        {items?.length === 0 && !adding && <li className="px-2 text-xs text-white/70">{t("skills.nav.none")}</li>}
        {(items ?? []).map((skill) => {
          const expanded = open.has(skill.id);
          const naming = addingIn?.skill === skill.id && addingIn.folder === "" ? addingIn : null;
          return (
            <li key={skill.id}>
              {renaming === skill.id ? (
                <form
                  className="flex items-center gap-2 px-2 py-0.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(skill.id, skill.name);
                  }}
                >
                  <Sparkles size={15} className="shrink-0 text-white/70" aria-hidden />
                  <input
                    className={nameInput}
                    autoFocus
                    value={newName}
                    maxLength={40}
                    aria-label={t("skills.nav.rename", { name: skill.name })}
                    disabled={busy}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => {
                      if (!busy) void rename(skill.id, skill.name);
                    }}
                  />
                </form>
              ) : (
                <div className="group/skill relative">
                  <button
                    type="button"
                    className={cn(row, "pr-14", selectedSkill === skill.id && !selectedFile && activeRow)}
                    onClick={() => openSkill(skill.id)}
                    aria-expanded={expanded}
                    aria-current={selectedSkill === skill.id && !selectedFile ? "page" : undefined}
                  >
                    <ChevronRight size={14} className={cn("shrink-0 transition-transform", expanded && "rotate-90")} aria-hidden />
                    <Sparkles size={15} className="shrink-0 opacity-80" aria-hidden />
                    <span className="truncate">{skill.name}</span>
                  </button>
                  {plusButton(skill.id, "", skill.id, t("skills.nav.addIn", { name: skill.name }), "group-hover/skill:opacity-100")}
                  <button
                    type="button"
                    className={cn(hoverBtn, "right-1 group-hover/skill:opacity-100")}
                    onClick={() => {
                      setNewName(skill.name);
                      setRenaming(skill.id);
                    }}
                    aria-label={t("skills.nav.rename", { name: skill.name })}
                    title={t("skills.nav.rename", { name: skill.name })}
                    data-track="Skills rename"
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                </div>
              )}
              {expanded && (
                <ul className="flex flex-col gap-0.5">
                  {naming && namingForm(naming, 1)}
                  {renderNodes(skill.id, buildTree(treeOf(skill)), 1)}
                </ul>
              )}
            </li>
          );
        })}
        {adding && (
          <li>
            <form
              className="flex items-center gap-2 px-2 py-0.5"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Sparkles size={15} className="shrink-0 text-white/70" aria-hidden />
              <input
                className={nameInput}
                autoFocus
                value={name}
                maxLength={40}
                placeholder={t("skills.nav.placeholder")}
                aria-label={t("skills.nav.name")}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={() => {
                  if (!name.trim() && !busy) setAdding(false);
                }}
              />
            </form>
          </li>
        )}
      </ul>
    </nav>
  );
}
