/**
 * The person's skills (`/api/v1/skills`, kept in Wysebee Cloud, 2026-11-17): one store, so the
 * Skills menu beside the rail and the page showing a skill agree on the list and on each
 * skill's files and folders — every skill answered whole, its files and the folders made that
 * hold none yet, so a change answers the skill as it now is.
 */

import { useSyncExternalStore } from "react";
import {
  createSkill,
  createSkillFolder,
  deleteSkill,
  deleteSkillFile,
  deleteSkillFolder,
  fetchSkill,
  fetchSkills,
  renameSkill as putSkillName,
  applySkillChange,
  saveSkillFile,
  uploadSkillFile,
  type WebSkill,
} from "./api";
import { reasonOf } from "./workspaces";

/** Every skill starts with it, and keeps it: its card, which Wysebee Cloud reads. */
export const SKILL_FILE = "SKILL.md";

interface SkillsState {
  /** By name; null until first read. */
  items: WebSkill[] | null;
  error: string | null;
}

let state: SkillsState = { items: null, error: null };
const listeners = new Set<() => void>();

function set(next: Partial<SkillsState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const byName = (a: WebSkill, b: WebSkill) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The skill as Wysebee Cloud answered it, in the list (added when new). */
function keep(skill: WebSkill): WebSkill {
  set({ items: [...(state.items ?? []).filter((s) => s.id !== skill.id), skill].sort(byName) });
  return skill;
}

let loading: Promise<void> | null = null;

/** Read the skills (once at a time). */
export function loadSkills(): Promise<void> {
  loading ??= fetchSkills()
    .then((r) => set({ items: [...r.skills].sort(byName), error: null }))
    .catch((e) => set({ error: reasonOf(e) }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Read one skill again. Throws the server's reason. */
export async function loadSkill(id: string): Promise<WebSkill> {
  return keep(await fetchSkill(id));
}

/** Start a skill: Wysebee Cloud writes it a starter SKILL.md. */
export async function addSkill(name: string): Promise<WebSkill> {
  return keep(await createSkill(name));
}

/** Rename a skill (and its SKILL.md's `name`). */
export async function renameSkill(id: string, name: string): Promise<WebSkill> {
  return keep(await putSkillName(id, name));
}

/** The skill and everything in it. */
export async function removeSkill(id: string): Promise<void> {
  await deleteSkill(id);
  set({ items: (state.items ?? []).filter((s) => s.id !== id) });
}

/** Write a text file (made when new). */
export async function writeFile(id: string, path: string, content: string): Promise<WebSkill> {
  return keep(await saveSkillFile(id, path, content));
}

/** Apply a change the person's AI app proposed: saved into the skill, which the store keeps. */
export async function applyChange(id: string, change: string): Promise<WebSkill> {
  return keep(await applySkillChange(id, change));
}

/** Upload files from the computer into a folder ("" the skill's own), one after another;
 * the skill as the last one left it. */
export async function upload(id: string, folder: string, files: File[]): Promise<WebSkill | null> {
  let last: WebSkill | null = null;
  for (const file of files) last = keep(await uploadSkillFile(id, folder ? `${folder}/${file.name}` : file.name, file));
  return last;
}

export async function removeFile(id: string, path: string): Promise<void> {
  await deleteSkillFile(id, path);
  await loadSkill(id);
}

export async function addFolder(id: string, path: string): Promise<WebSkill> {
  return keep(await createSkillFolder(id, path));
}

export async function removeFolder(id: string, path: string): Promise<void> {
  await deleteSkillFolder(id, path);
  await loadSkill(id);
}

export function useSkills(): SkillsState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** For tests: forget what was read. */
export function resetSkills(): void {
  state = { items: null, error: null };
  loading = null;
}

/** A skill's files and folders, as the tree reads them. */
export function treeOf(skill: WebSkill): { files: { path: string; size: number }[]; folders: string[] } {
  return { files: skill.files, folders: skill.folders ?? [] };
}
