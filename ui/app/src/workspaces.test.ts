import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { mockFetch, reply, type FakeRequest } from "../../test/fetch";
import { PATH_RULE, fetchSkillFile, workspacePath } from "./api";
import { useFetchTransport } from "../../test/transport";
import {
  addFolder,
  addWorkspace,
  buildTree,
  loadWorkspaces,
  loadTree,
  pagePath,
  htmlPagePath,
  isHtmlPage,
  starterPage,
  reasonOf,
  removeFile,
  removeFolder,
  removeWorkspace,
  renameWorkspace,
  resetWorkspaces,
  useWorkspaces,
  writeFile,
} from "./workspaces";

const workspace = (id: string, name: string) => ({ id, name, resource_url: `https://acct/user-workspaces/me/${name}/` });

beforeEach(() => resetWorkspaces());
useFetchTransport();

describe("the workspaces store", () => {
  it("reads the workspaces by name, starts and deletes them, and keeps each tree", async () => {
    const tree = { ...workspace("p1", "Zeta"), files: [{ path: "README.md", size: 3 }], folders: [] };
    const f = mockFetch({
      "GET /api/v1/workspaces": { workspaces: [workspace("p1", "Zeta"), workspace("p2", "alpha")] },
      "POST /api/v1/workspaces": (r: FakeRequest) => reply(201, workspace("p3", (r.body as { name: string }).name)),
      "GET /api/v1/workspaces/p1": tree,
      "DELETE /api/v1/workspaces/p1": reply(204),
      "PUT /api/v1/workspaces/p1/files/guide/My%20Setup.md": { path: "guide/My Setup.md", size: 1 },
      "DELETE /api/v1/workspaces/p1/files/README.md": reply(204),
      "POST /api/v1/workspaces/p1/folders/notes": reply(201, { path: "notes" }),
      "DELETE /api/v1/workspaces/p1/folders/notes": reply(204),
    });
    const { result } = renderHook(() => useWorkspaces());
    await act(() => Promise.all([loadWorkspaces(), loadWorkspaces()]));
    expect(f.to("GET /api/v1/workspaces")).toHaveLength(1);
    expect(result.current.items?.map((p) => p.name)).toEqual(["alpha", "Zeta"]);

    await act(async () => void (await addWorkspace("Beta")));
    expect(result.current.items?.map((p) => p.name)).toEqual(["alpha", "Beta", "Zeta"]);

    await act(async () => void (await loadTree("p1")));
    expect(result.current.trees.p1.files).toEqual(tree.files);
    await act(() => writeFile("p1", "guide/My Setup.md", "x"));
    await act(() => removeFile("p1", "README.md"));
    await act(() => addFolder("p1", "notes"));
    await act(() => removeFolder("p1", "notes"));
    expect(f.to("GET /api/v1/workspaces/p1")).toHaveLength(5);

    await act(() => removeWorkspace("p1"));
    expect(result.current.items?.map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(result.current.trees.p1).toBeUndefined();
  });

  it("starts with no list when one is added before it is read, and says why a read failed", async () => {
    mockFetch({
      "POST /api/v1/workspaces": reply(201, workspace("p1", "One")),
      "GET /api/v1/workspaces": reply(503, { detail: "Could not reach Wysebee Cloud." }),
    });
    const { result } = renderHook(() => useWorkspaces());
    await act(async () => void (await addWorkspace("One")));
    expect(result.current.items?.map((p) => p.id)).toEqual(["p1"]);
    await act(() => loadWorkspaces());
    expect(result.current.error).toBe("Could not reach Wysebee Cloud.");
    await act(async () => {
      resetWorkspaces();
      await removeWorkspace("gone").catch(() => {});
    });
  });

  it("renames a workspace, its open tree too, and one in an unread list", async () => {
    const tree = { ...workspace("p1", "Zeta"), files: [], folders: [] };
    mockFetch({
      "GET /api/v1/workspaces": { workspaces: [workspace("p1", "Zeta"), workspace("p2", "alpha")] },
      "GET /api/v1/workspaces/p1": tree,
      "PUT /api/v1/workspaces/p1": (r: FakeRequest) => workspace("p1", (r.body as { name: string }).name),
      "PUT /api/v1/workspaces/p2": (r: FakeRequest) => workspace("p2", (r.body as { name: string }).name),
    });
    const { result } = renderHook(() => useWorkspaces());
    await act(async () => void (await renameWorkspace("p1", "gone")));
    expect(result.current.items).toEqual([]);
    await act(() => loadWorkspaces());
    await act(async () => void (await renameWorkspace("p2", "Omega")));
    expect(result.current.items?.map((p) => p.name)).toEqual(["Omega", "Zeta"]);
    expect(result.current.trees.p2).toBeUndefined();
    await act(async () => void (await loadTree("p1")));
    await act(async () => void (await renameWorkspace("p1", "Alpha")));
    expect(result.current.items?.map((p) => p.name)).toEqual(["Alpha", "Omega"]);
    expect(result.current.trees.p1.name).toBe("Alpha");
  });

  it("removes from an unread list too", async () => {
    mockFetch({ "DELETE /api/v1/workspaces/p9": reply(204) });
    const { result } = renderHook(() => useWorkspaces());
    await act(() => removeWorkspace("p9"));
    expect(result.current.items).toEqual([]);
  });
});

describe("the tree and names", () => {
  it("puts folders first, then files, each by name, nested by path", () => {
    const nodes = buildTree({
      files: [{ path: "b.md", size: 1 }, { path: "A.md", size: 1 }, { path: "guide/setup.md", size: 1 }, { path: "deep/x/y.md", size: 1 }],
      folders: ["guide", "notes", "deep", "deep/x"],
    });
    const flat = (ns: typeof nodes, depth = 0): string[] => ns.flatMap((n) => [`${"-".repeat(depth)}${n.kind}:${n.path}`, ...flat(n.children, depth + 1)]);
    expect(flat(nodes)).toEqual([
      "folder:deep",
      "-folder:deep/x",
      "--file:deep/x/y.md",
      "folder:guide",
      "-file:guide/setup.md",
      "folder:notes",
      "file:A.md",
      "file:b.md",
    ]);
  });

  it("names a new page, adding .md when it has no extension", () => {
    expect(pagePath("", " guide/start ")).toBe("guide/start.md");
    expect(pagePath("guide", "/notes.txt/")).toBe("guide/notes.txt");
  });

  it("names a new page made directly, adding .html, and starts it with its title escaped", () => {
    expect(htmlPagePath("", " reports/sales ")).toBe("reports/sales.html");
    expect(htmlPagePath("site", "Home.HTML")).toBe("site/Home.HTML");
    expect(htmlPagePath("", "notes.")).toBe("notes.html");
    expect(isHtmlPage("a/b.html") && isHtmlPage("B.HTML") && !isHtmlPage("b.md") && !isHtmlPage("b.htm")).toBe(true);
    const page = starterPage("A <b> & c");
    expect(page).toContain("<title>A &lt;b&gt; &amp; c</title>");
    expect(page).toContain("<h1>A &lt;b&gt; &amp; c</h1>");
  });

  it("says an error's reason without its status, and encodes paths a segment at a time", () => {
    expect(reasonOf(new Error("HTTP 502: Taken."))).toBe("Taken.");
    expect(reasonOf("plain")).toBe("plain");
    expect(workspacePath("a b/c?.md")).toBe("a%20b/c%3F.md");
  });

  it("refuses a '.' or '..' in a path before asking, since the browser would send it elsewhere", async () => {
    expect(() => workspacePath("../bad")).toThrow(`'../bad' cannot be a path: ${PATH_RULE}`);
    expect(() => workspacePath("guide/./x.md")).toThrow(PATH_RULE);
    expect(workspacePath("v1.2/.notes")).toBe("v1.2/.notes");
    const f = mockFetch({});
    await expect(addFolder("p1", "../bad")).rejects.toThrow(PATH_RULE);
    await expect(fetchSkillFile("s1", "..")).rejects.toThrow(PATH_RULE);
    expect(f.calls).toHaveLength(0);
  });
});
