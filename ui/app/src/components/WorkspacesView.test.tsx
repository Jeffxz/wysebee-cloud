import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import * as api from "../api";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { loadWorkspaces, resetWorkspaces } from "../workspaces";
import { hasUnsavedWorkspaceEdits, WorkspacesView } from "./WorkspacesView";
import { useFetchTransport } from "../../../test/transport";
import { dialogs } from "./common/confirm";


const workspace = (id: string, name: string) => ({ id, name, resource_url: `https://acct.blob.core.windows.net/user-workspaces/me/${name}/` });
const tree = { ...workspace("p1", "Docs"), files: [{ path: "README.md", size: 9 }], folders: ["guide"] };

beforeEach(() => {
  resetWorkspaces();
  vi.restoreAllMocks();
});

// After the reset above, which would undo its spy.
useFetchTransport();

function setup(p: { workspace?: string | null; file?: string | null; folder?: string | null; start?: boolean } = {}, routes: Record<string, unknown> = {}) {
  const f = mockFetch({
    "GET /api/v1/workspaces": { workspaces: [workspace("p1", "Docs")] },
    "GET /api/v1/workspaces/p1": tree,
    "POST /api/v1/workspaces": (r: FakeRequest) =>
      (r.body as { name: string }).name === "Taken" ? reply(409, { detail: "You already have a workspace named 'Taken'." }) : reply(201, workspace("p2", (r.body as { name: string }).name)),
    "GET /api/v1/workspaces/p1/files/README.md": { path: "README.md", content: "# Docs\n", size: 7 },
    "PUT /api/v1/workspaces/p1/files/README.md": (r: FakeRequest) => ((r.body as { content: string }).content === "fail" ? reply(413, { detail: "Too big." }) : { path: "README.md", size: 1 }),
    "DELETE /api/v1/workspaces/p1/files/README.md": reply(204),
    "DELETE /api/v1/workspaces/p1": reply(204),
    "PUT /api/v1/workspaces/p1/files/guide/start.md": { path: "guide/start.md", size: 8 },
    "POST /api/v1/workspaces/p1/folders/notes": reply(201, { path: "notes" }),
    ...routes,
  });
  const onOpen = vi.fn();
  const props = { workspace: p.workspace ?? null, file: p.file ?? null, folder: p.folder ?? null, start: p.start, onOpen, currentUserEmail: "me@x" };
  const utils = render(<WorkspacesView {...props} />);
  return { f, onOpen, props, ...utils };
}

describe("WorkspacesView", () => {
  it("starts a first workspace by its name, and says why one could not be started", async () => {
    const { onOpen } = setup({}, { "GET /api/v1/workspaces": { workspaces: [] } });
    expect(await screen.findByRole("heading", { name: "Start your first workspace" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Workspace name" });
    const start = screen.getByRole("button", { name: "Start workspace" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(input.closest("form")!);
    await userEvent.type(input, "Taken");
    await userEvent.click(start);
    expect(await screen.findByText("You already have a workspace named 'Taken'.")).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, "Website");
    await userEvent.click(start);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p2", "README.md"));
  });

  it("lists all the workspaces, each opening it, with who made it and when it changed", async () => {
    const { onOpen } = setup({}, {
      "GET /api/v1/workspaces": {
        workspaces: [
          { ...workspace("p1", "Docs"), updated_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), created_by: { id: "u1", name: "Jo", email: "me@x" } },
          workspace("p2", "Notes"),
        ],
      },
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
    const docs = await screen.findByRole("button", { name: /Docs/ });
    expect(within(docs).getByText("Made by you")).toBeTruthy();
    expect(within(docs).getByText("Changed 3 days ago")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /Notes/ })).queryByText(/Changed/)).toBeNull();
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    // No start form until asked.
    expect(screen.queryByRole("heading", { name: "Start a workspace" })).toBeNull();
    await userEvent.click(docs);
    expect(onOpen).toHaveBeenLastCalledWith("p1");
  });

  it("offers to start another when there are some, and says why they could not be read", async () => {
    const first = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Start a workspace" }));
    expect(screen.getByRole("heading", { name: "Start a workspace" })).toBeTruthy();
    first.unmount();
    resetWorkspaces();
    // Asked for from Home: shown from the first.
    const again = setup({ start: true });
    expect(await screen.findByRole("heading", { name: "Start a workspace" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Docs/ })).toBeTruthy();
    again.unmount();
    resetWorkspaces();
    setup({}, { "GET /api/v1/workspaces": reply(503, { detail: "Offline." }) });
    expect(await screen.findByText("Offline.")).toBeTruthy();
  });

  it("shows a workspace: its counts, not where it is kept, and adds a page or a folder", async () => {
    const { onOpen, f } = setup({ workspace: "p1" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Docs" })).toBeTruthy();
    expect(screen.queryByText("https://acct.blob.core.windows.net/user-workspaces/me/Docs/")).toBeNull();
    expect(screen.queryByText(/Kept in Wysebee Cloud/)).toBeNull();
    expect(await screen.findByText(/1 files in 1 folders/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "New document" }));
    const page = screen.getByRole("textbox", { name: "Document name" });
    fireEvent.submit(page.closest("form")!);
    await userEvent.type(page, "guide/start");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p1", "guide/start.md"));
    expect(f.to("PUT /api/v1/workspaces/p1/files/guide/start.md")[0].body).toEqual({ content: "# start\n" });

    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "/notes/");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(f.to("POST /api/v1/workspaces/p1/folders/notes")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull());

    // A refusal is said; Cancel and Escape close the form.
    const toastError = vi.spyOn(toast, "error");
    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "bad");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "New document" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Document name" }), "{Escape}");
    expect(screen.queryByRole("textbox", { name: "Document name" })).toBeNull();
  });

  it("shows a folder picked in the menu: where it is, what it holds, and adds inside it", async () => {
    const deep = { ...tree, files: [{ path: "README.md", size: 9 }, { path: "guide/a.md", size: 1 }, { path: "guide/how/b.md", size: 1 }], folders: ["guide", "guide/how"] };
    const { onOpen, f } = setup({ workspace: "p1", folder: "guide/how" }, {
      "GET /api/v1/workspaces/p1": deep,
      "PUT /api/v1/workspaces/p1/files/guide/how/c.md": { path: "guide/how/c.md", size: 4 },
      "POST /api/v1/workspaces/p1/folders/guide/how/more": reply(201, { path: "guide/how/more" }),
      "DELETE /api/v1/workspaces/p1/folders/guide/how": reply(204),
    });
    expect(await screen.findByRole("heading", { name: "how" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete workspace" })).toBeNull();
    expect(await screen.findByText(/1 files in 0 folders/)).toBeTruthy();
    // Its path leads back up: the workspace, then each folder it is in.
    const path = screen.getByRole("navigation", { name: "Where this folder is" });
    await userEvent.click(within(path).getByRole("button", { name: "guide" }));
    expect(onOpen).toHaveBeenLastCalledWith("p1", undefined, "guide");
    await userEvent.click(within(path).getByRole("button", { name: "Docs" }));
    expect(onOpen).toHaveBeenLastCalledWith("p1");

    await userEvent.click(screen.getByRole("button", { name: "New document" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Document name" }), "c");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith("p1", "guide/how/c.md"));
    expect(f.to("PUT /api/v1/workspaces/p1/files/guide/how/c.md")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "New folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "more");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(f.to("POST /api/v1/workspaces/p1/folders/guide/how/more")).toHaveLength(1));

    vi.spyOn(dialogs, "confirm").mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(f.to("DELETE /api/v1/workspaces/p1/folders/guide/how")).toHaveLength(1));
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith("p1", undefined, "guide"));
  });

  it("deletes a folder at the top from its page, when confirmed, going back to the workspace", async () => {
    const { onOpen, f } = setup({ workspace: "p1", folder: "guide" }, {
      "DELETE /api/v1/workspaces/p1/folders/guide": (() => {
        let n = 0;
        return () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204));
      })(),
    });
    expect(await screen.findByRole("heading", { name: "guide" })).toBeTruthy();
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    const del = screen.getByRole("button", { name: "Delete folder" });
    await userEvent.click(del);
    expect(f.to("DELETE /api/v1/workspaces/p1/folders/guide")).toHaveLength(0);
    confirm.mockResolvedValue(true);
    const toastError = vi.spyOn(toast, "error");
    await userEvent.click(del);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(del);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p1", undefined, undefined));
  });

  it("says when the folder asked for is not there", async () => {
    setup({ workspace: "p1", folder: "gone" });
    expect(await screen.findByText("This folder is not there any more.")).toBeTruthy();
  });

  it("deletes a workspace when confirmed", async () => {
    const { onOpen } = setup({ workspace: "p1" }, {
      "DELETE /api/v1/workspaces/p1": (() => {
        let n = 0;
        return () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204));
      })(),
    });
    await screen.findByRole("heading", { name: "Docs" });
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    confirm.mockResolvedValue(true);
    const toastError = vi.spyOn(toast, "error");
    await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    await userEvent.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(null));
  });

  it("waits for a workspace's tree it could not read yet", async () => {
    vi.spyOn(toast, "error");
    setup({ workspace: "p1" }, { "GET /api/v1/workspaces/p1": reply(503, { detail: "Offline." }) });
    expect(await screen.findByRole("heading", { name: "Docs" })).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("says when a workspace is gone, or its tree could not be read", async () => {
    const toastError = vi.spyOn(toast, "error");
    setup({ workspace: "p9" }, { "GET /api/v1/workspaces/p9": reply(404, { detail: "Workspace not found." }) });
    expect(await screen.findByText("This workspace is not there any more.")).toBeTruthy();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Workspace not found."));
  });

  it("edits a file, previews it, saves it and deletes it", async () => {
    const { onOpen, f } = setup({ workspace: "p1", file: "README.md" });
    const text = await screen.findByRole("textbox", { name: "The text of README.md" });
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(hasUnsavedWorkspaceEdits()).toBe(false);
    await userEvent.type(text, "More.");
    expect(hasUnsavedWorkspaceEdits()).toBe(true);
    // Cmd/Ctrl+S saves; plain S types.
    const success = vi.spyOn(toast, "success");
    fireEvent.keyDown(text, { key: "s", metaKey: true });
    await waitFor(() => expect(success).toHaveBeenCalledWith("Saved to Wysebee Cloud."));
    expect(f.to("PUT /api/v1/workspaces/p1/files/README.md")[0].body).toEqual({ content: "# Docs\nMore." });
    expect(hasUnsavedWorkspaceEdits()).toBe(false);
    fireEvent.keyDown(text, { key: "s", ctrlKey: true });
    expect(f.to("PUT /api/v1/workspaces/p1/files/README.md")).toHaveLength(1);

    // A refusal is said, and the edit is kept.
    const toastError = vi.spyOn(toast, "error");
    fireEvent.change(text, { target: { value: "fail" } });
    await userEvent.click(save);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too big."));
    expect(hasUnsavedWorkspaceEdits()).toBe(true);

    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("fail")).toBeTruthy();
    fireEvent.change(screen.getByRole("tab", { name: "Edit" }), {});
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "The text of README.md" }), { target: { value: "" } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("Nothing written yet.")).toBeTruthy();

    // Edit, Preview, Page, Save and Delete are icons, each named in a tooltip shown on hover.
    const icons = [...["Edit", "Preview", "Page"].map((name) => screen.getByRole("tab", { name })), ...["Save", "Delete this file"].map((name) => screen.getByRole("button", { name }))];
    for (const icon of icons) {
      const tip = icon.querySelector("[data-tip]");
      expect(tip?.textContent).toBe(icon.getAttribute("aria-label"));
      expect(icon.textContent).toBe(tip?.textContent);
      expect(icon.className).toContain("group");
    }
    // Page: the rich HTML page the AI app made from it, or how to get one.
    vi.spyOn(api, "fetchDocumentPage").mockResolvedValue({ page: null });
    await userEvent.click(screen.getByRole("tab", { name: "Page" }));
    expect(await screen.findByText("No page for this document yet.")).toBeTruthy();

    // Frontmatter shows as a table above the page, a list's items each on its own.
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    const box = () => screen.getByRole("textbox", { name: "The text of README.md" });
    fireEvent.change(box(), { target: { value: "---\nname: Design\ntags:\n  - cloud\n  - desktop\nowner:\n---\n\n# Body heading\n" } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const details = screen.getByRole("table", { name: "Page details" });
    expect(within(details).getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["name", "tags", "owner"]);
    expect(within(details).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["cloud", "desktop"]);
    expect(within(details).getByText("—")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Body heading" })).toBeTruthy();
    expect(screen.queryByText(/name: Design/)).toBeNull();
    // Only frontmatter: the table, and no empty page under it.
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "---\nname: Design\n---\n" } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("table", { name: "Page details" })).toBeTruthy();
    expect(screen.queryByText("Nothing written yet.")).toBeNull();
    // A skill's scripts: one row, each script on its own line.
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "---\nname: report\nscripts:\n  - name: hello\n    command: ./hello.sh\n---\n" } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(within(screen.getByRole("table", { name: "Page details" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["name: hello · command: ./hello.sh"]);
    // A block in a shape it does not read: shown as written, not as the page's markdown.
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    fireEvent.change(box(), { target: { value: "---\nnot a field\n---\n\n# After\n" } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByLabelText("Page details").tagName).toBe("PRE");
    expect(screen.getByLabelText("Page details").textContent).toBe("not a field");
    expect(screen.getByRole("heading", { name: "After" })).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();

    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    expect(onOpen).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p1"));
    expect(hasUnsavedWorkspaceEdits()).toBe(false);
  });

  it("makes a page directly: a .html file from a starter, opened on its Page", async () => {
    const { onOpen, f } = setup({ workspace: "p1" }, { "PUT /api/v1/workspaces/p1/files/reports/sales.html": { path: "reports/sales.html", size: 9 } });
    await screen.findByRole("heading", { name: "Docs" });
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Page name" }), "reports/sales");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("p1", "reports/sales.html"));
    const written = (f.to("PUT /api/v1/workspaces/p1/files/reports/sales.html")[0].body as { content: string }).content;
    expect(written).toContain("<title>sales</title>");
    expect(written).toContain("prefers-color-scheme: dark");
    // Escape puts the form away.
    await userEvent.click(screen.getByRole("button", { name: "New page" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Page name" }), "{Escape}");
    expect(screen.queryByRole("textbox", { name: "Page name" })).toBeNull();
  });

  it("shows a .html file as its page, with Source to edit it, and reads the page again when saved", async () => {
    const html = "<!doctype html><title>Sales</title><p>1</p>";
    const found = vi.spyOn(api, "fetchDocumentPage").mockResolvedValue({ page: { id: "pg1", title: "Sales", updated_at: "" } });
    vi.spyOn(api, "fetchPage").mockResolvedValue({
      id: "pg1", workspace_id: "p1", workspace_name: "Docs", source_path: "sales.html", kind: "file", title: "Sales", view_url: "/api/v1/page-view/pg1/k", updated_at: "",
    });
    const { f } = setup({ workspace: "p1", file: "sales.html" }, {
      "GET /api/v1/workspaces/p1/files/sales.html": { path: "sales.html", content: html, size: html.length },
      "PUT /api/v1/workspaces/p1/files/sales.html": { path: "sales.html", size: 1 },
    });
    // On its Page first, said to be sandboxed; no markdown Edit or Preview.
    expect(await screen.findByTitle("Sales")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Page" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(/Shown sandboxed/)).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
    expect(found).toHaveBeenCalledTimes(1);
    // Source: its HTML, edited; the Page says it shows what is saved until it is.
    await userEvent.click(screen.getByRole("tab", { name: "Source (HTML)" }));
    const box = screen.getByRole("textbox", { name: "The text of sales.html" });
    expect((box as HTMLTextAreaElement).value).toBe(html);
    fireEvent.change(box, { target: { value: "<p>2</p>" } });
    await userEvent.click(screen.getByRole("tab", { name: "Page" }));
    expect(screen.getByText(/Save to see your changes here/)).toBeTruthy();
    await screen.findByTitle("Sales");
    const before = found.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.to("PUT /api/v1/workspaces/p1/files/sales.html")).toHaveLength(1));
    await waitFor(() => expect(found).toHaveBeenCalledTimes(before + 1));
    expect(screen.queryByText(/Save to see your changes here/)).toBeNull();
  });

  it("says why a file could not be deleted", async () => {
    setup({ workspace: "p1", file: "README.md" }, { "DELETE /api/v1/workspaces/p1/files/README.md": reply(500, { detail: "Boom." }) });
    await screen.findByRole("textbox", { name: "The text of README.md" });
    vi.spyOn(dialogs, "confirm").mockResolvedValue(true);
    const toastError = vi.spyOn(toast, "error");
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
  });

  it("edits a text file with no preview, and says when a file cannot be read", async () => {
    const first = setup({ workspace: "p1", file: "notes.txt" }, { "GET /api/v1/workspaces/p1/files/notes.txt": { path: "notes.txt", content: "plain", size: 5 } });
    expect(await screen.findByDisplayValue("plain")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
    first.unmount();
    setup({ workspace: "p1", file: "gone.md" }, { "GET /api/v1/workspaces/p1/files/gone.md": reply(404, { detail: "File not found." }) });
    expect(await screen.findByText("File not found.")).toBeTruthy();
  });

  it("goes to a skill the AI app made while a page was open here", async () => {
    const onOpenSkill = vi.fn();
    let polls = 0;
    const f = mockFetch({
      "GET /api/v1/workspaces": { workspaces: [workspace("p1", "Docs")] },
      "GET /api/v1/workspaces/p1/files/README.md": { path: "README.md", content: "# Docs\n", size: 7 },
      "POST /api/v1/workspaces/p1/assistant": { on: true, url: "https://x/assistant/mcp", path: "README.md", revision: 1, writer: "person" },
    });
    f.set(/^GET \/api\/v1\/workspaces\/p1\/assistant\?/, () => (++polls === 1 ? { on: false, url: "u", opened: { skill_id: "s7", path: "SKILL.md" } } : new Promise(() => {})));
    render(<WorkspacesView workspace="p1" file="README.md" onOpen={vi.fn()} onOpenSkill={onOpenSkill} />);
    await waitFor(() => expect(onOpenSkill).toHaveBeenCalledWith("s7", "SKILL.md"));
  });

  it("drops a file's answer that comes after another file was opened", async () => {
    let answer: (v: unknown) => void = () => {};
    const { rerender, props } = setup({ workspace: "p1", file: "slow.md" }, {
      "GET /api/v1/workspaces/p1/files/slow.md": () => new Promise((r) => (answer = r)),
      "GET /api/v1/workspaces/p1/files/slow-fail.md": () => new Promise((r) => (answer = r)),
    });
    await act(() => loadWorkspaces());
    rerender(<WorkspacesView {...props} file="README.md" />);
    await screen.findByDisplayValue("# Docs");
    await act(async () => answer({ path: "slow.md", content: "late", size: 4 }));
    expect(screen.queryByDisplayValue("late")).toBeNull();
    rerender(<WorkspacesView {...props} file="slow-fail.md" />);
    rerender(<WorkspacesView {...props} file="README.md" />);
    await act(async () => answer(reply(500, { detail: "late failure" })));
    expect(screen.queryByText("late failure")).toBeNull();
  });
});
