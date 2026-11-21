/**
 * The person's workspaces (`/api/v1/workspaces`, kept in Wysebee Cloud): one store, so the
 * Workspaces menu beside the rail and the page showing a workspace agree on the list and on
 * each workspace's folder structure.
 */

import { useSyncExternalStore } from "react";
import {
  createWorkspace,
  createWorkspaceFolder,
  renameWorkspace as putWorkspaceName,
  deleteWorkspace,
  deleteWorkspaceFile,
  deleteWorkspaceFolder,
  fetchWorkspace,
  fetchWorkspaces,
  saveWorkspaceFile,
  type Workspace,
  type WorkspaceDetail,
} from "./api";

interface WorkspacesState {
  /** By name; null until first read. */
  items: Workspace[] | null;
  error: string | null;
  /** Each workspace's folder structure, once read. */
  trees: Record<string, WorkspaceDetail>;
}

let state: WorkspacesState = { items: null, error: null, trees: {} };
const listeners = new Set<() => void>();

function set(next: Partial<WorkspacesState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** An error's sentence, without the "HTTP 502: " the API helpers put first. */
export function reasonOf(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^HTTP \d+: /, "");
}

const byName = (a: Workspace, b: Workspace) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

let loading: Promise<void> | null = null;

/** Read the workspaces (once at a time). */
export function loadWorkspaces(): Promise<void> {
  loading ??= fetchWorkspaces()
    .then((r) => set({ items: [...r.workspaces].sort(byName), error: null }))
    .catch((e) => set({ error: reasonOf(e) }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Read one workspace's folder structure again. Throws the server's reason. */
export async function loadTree(id: string): Promise<WorkspaceDetail> {
  const tree = await fetchWorkspace(id);
  set({ trees: { ...state.trees, [id]: tree } });
  return tree;
}

/** Start a workspace: its row and its folder, with a first README.md. */
export async function addWorkspace(name: string): Promise<Workspace> {
  const workspace = await createWorkspace(name);
  set({ items: [...(state.items ?? []).filter((p) => p.id !== workspace.id), workspace].sort(byName) });
  return workspace;
}

/** Rename a workspace; its open tree keeps its files and takes the new name. */
export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const workspace = await putWorkspaceName(id, name);
  const tree = state.trees[id];
  set({
    items: (state.items ?? []).map((p) => (p.id === id ? workspace : p)).sort(byName),
    ...(tree ? { trees: { ...state.trees, [id]: { ...tree, name: workspace.name } } } : {}),
  });
  return workspace;
}

/** The workspace, its folder and everything in it. */
export async function removeWorkspace(id: string): Promise<void> {
  await deleteWorkspace(id);
  const trees = { ...state.trees };
  delete trees[id];
  set({ items: (state.items ?? []).filter((p) => p.id !== id), trees });
}

/** Write a file (made when new), then read the tree again. */
export async function writeFile(id: string, path: string, content: string): Promise<void> {
  await saveWorkspaceFile(id, path, content);
  await loadTree(id);
}

export async function removeFile(id: string, path: string): Promise<void> {
  await deleteWorkspaceFile(id, path);
  await loadTree(id);
}

export async function addFolder(id: string, path: string): Promise<void> {
  await createWorkspaceFolder(id, path);
  await loadTree(id);
}

export async function removeFolder(id: string, path: string): Promise<void> {
  await deleteWorkspaceFolder(id, path);
  await loadTree(id);
}

export function useWorkspaces(): WorkspacesState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** For tests: forget what was read. */
export function resetWorkspaces(): void {
  state = { items: null, error: null, trees: {} };
  loading = null;
}

// --- the tree, as the menu shows it ------------------------------------------------------

export interface TreeNode {
  name: string;
  /** The path inside the workspace. */
  path: string;
  kind: "folder" | "file";
  children: TreeNode[];
}

/** The workspace's files and folders as a tree: folders first, then files, each by name. */
export function buildTree(detail: Pick<WorkspaceDetail, "files" | "folders">): TreeNode[] {
  const root: TreeNode = { name: "", path: "", kind: "folder", children: [] };
  const folderAt = (path: string): TreeNode => {
    let node = root;
    for (const part of path.split("/")) {
      const childPath = node.path ? `${node.path}/${part}` : part;
      let next = node.children.find((c) => c.kind === "folder" && c.name === part);
      if (!next) {
        next = { name: part, path: childPath, kind: "folder", children: [] };
        node.children.push(next);
      }
      node = next;
    }
    return node;
  };
  for (const folder of detail.folders) folderAt(folder);
  for (const file of detail.files) {
    const cut = file.path.lastIndexOf("/");
    const parent = cut < 0 ? root : folderAt(file.path.slice(0, cut));
    parent.children.push({ name: file.path.slice(cut + 1), path: file.path, kind: "file", children: [] });
  }
  const rank = (n: TreeNode) => (n.kind === "folder" ? 0 : 1);
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
      .map((n) => ({ ...n, children: sort(n.children) }));
  return sort(root.children);
}

/** What a new page is called: ".md" added when the name has no extension. */
export function pagePath(folder: string, name: string): string {
  const clean = name.trim().replace(/^\/+|\/+$/g, "");
  const withExt = /\.[A-Za-z0-9]+$/.test(clean) ? clean : `${clean}.md`;
  return folder ? `${folder}/${withExt}` : withExt;
}
