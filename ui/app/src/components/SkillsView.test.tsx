import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { loadSkills, resetSkills } from "../skills";
import { hasUnsavedSkillEdits, SkillsView } from "./SkillsView";
import { useFetchTransport } from "../../../test/transport";
import { dialogs } from "./common/confirm";

// Downloads go straight to Wysebee Cloud, signed (cloud/data.ts).
vi.mock("../cloud/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cloud/auth")>()), accessToken: async () => "tok", reauthenticate: async () => {} }));

const me = { id: "u1", name: "Sam", email: "sam@x.io" };
const REPORT = {
  id: "s1",
  name: "report",
  description: "Weekly reports.",
  files: [{ path: "SKILL.md", id: "f1", size: 40 }, { path: "scripts/run.py", id: "f2", size: 5 }, { path: "logo.png", id: "f3", size: 1234 }],
  folders: [],
  updated_at: null,
  created_by: me,
  updated_by: me,
};
const CARD = "---\nname: report\ndescription: Weekly reports.\n---\n\n# report\n";

beforeEach(() => {
  resetSkills();
  vi.restoreAllMocks();
});

useFetchTransport();

function setup(p: { skill?: string | null; file?: string | null } = {}, routes: Record<string, unknown> = {}) {
  const f = mockFetch({
    "GET /api/v1/skills": { skills: [REPORT] },
    "POST /api/v1/skills": (r: FakeRequest) =>
      (r.body as { name: string }).name === "taken" ? reply(409, { detail: "There is already a skill named 'taken'." }) : reply(201, { ...REPORT, id: "s2", name: (r.body as { name: string }).name }),
    "GET /api/v1/skills/s1/files/SKILL.md": { path: "SKILL.md", content: CARD, size: 40 },
    "GET /api/v1/skills/s1/files/scripts/run.py": { path: "scripts/run.py", content: "print(1)", size: 8 },
    "GET /api/v1/skills/s1/files/logo.png": reply(422, { detail: "'logo.png' is not text: download it instead." }),
    "PUT /api/v1/skills/s1/files/SKILL.md": (r: FakeRequest) => ((r.body as { content: string }).content.includes("broken") ? reply(422, { detail: "SKILL.md starts with a line '---'." }) : REPORT),
    "PUT /api/v1/skills/s1/files/scripts/run.py": REPORT,
    "DELETE /api/v1/skills/s1/files/scripts/run.py": reply(204),
    "GET /api/v1/skills/s1": REPORT,
    "GET /api/v1/skills/s1/agents": { agents: [] },
    "DELETE /api/v1/skills/s1": reply(204),
    ...routes,
  });
  const onOpen = vi.fn();
  const props = { skill: p.skill ?? null, file: p.file ?? null, onOpen, currentUserEmail: "sam@x.io" };
  return { f, onOpen, props, ...render(<SkillsView {...props} />) };
}

describe("SkillsView", () => {
  it("reads the open file again when a change the AI app proposed for it is applied", async () => {
    let applied = false;
    const c = { id: "c1", path: "scripts/run.py", folder: false, size: 8, new: false, created_at: "2026-11-17T00:00:00Z" };
    const o = { ...c, id: "c2", path: "notes.md", new: true };
    const { f } = setup(
      { skill: "s1", file: "scripts/run.py" },
      {
        "GET /api/v1/skills/s1/changes": () => ({ changes: applied ? [] : [c, o] }),
        "POST /api/v1/skills/s1/changes/c2/apply": REPORT,
        "POST /api/v1/skills/s1/changes/c1/apply": () => {
          applied = true;
          return REPORT;
        },
        "GET /api/v1/skills/s1/files/scripts/run.py": () => ({ path: "scripts/run.py", content: applied ? "print(2)" : "print(1)", size: 8 }),
      },
    );
    expect(await screen.findByDisplayValue("print(1)")).toBeTruthy();
    // Another file's change leaves the open one as it is.
    await userEvent.click(await screen.findByRole("button", { name: "Apply notes.md" }));
    await waitFor(() => expect(f.to("POST /api/v1/skills/s1/changes/c2/apply")).toHaveLength(1));
    expect(f.to("GET /api/v1/skills/s1/files/scripts/run.py")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Apply scripts/run.py" }));
    expect(await screen.findByDisplayValue("print(2)")).toBeTruthy();
  });

  it("starts a first skill by its name, and says why one could not be started", async () => {
    const { onOpen } = setup({}, { "GET /api/v1/skills": { skills: [] } });
    expect(await screen.findByRole("heading", { name: "Start your first skill" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Skill name" });
    fireEvent.submit(input.closest("form")!);
    await userEvent.type(input, "taken");
    await userEvent.click(screen.getByRole("button", { name: "Start skill" }));
    expect(await screen.findByText("There is already a skill named 'taken'.")).toBeTruthy();
    await userEvent.clear(input);
    await userEvent.type(input, "weekly");
    await userEvent.click(screen.getByRole("button", { name: "Start skill" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("s2", "SKILL.md"));
  });

  it("lists all the skills, each opening it, with what it is for, who made it and when it changed", async () => {
    const { onOpen } = setup({}, {
      "GET /api/v1/skills": { skills: [{ ...REPORT, updated_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }, { ...REPORT, id: "s2", name: "blank", description: "", created_by: null }] },
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
    const report = await screen.findByRole("button", { name: /report/ });
    expect(within(report).getByText("Weekly reports.")).toBeTruthy();
    expect(within(report).getByText("Made by you")).toBeTruthy();
    expect(within(report).getByText("Changed 2 days ago")).toBeTruthy();
    const blank = screen.getByRole("button", { name: /blank/ });
    expect(blank.textContent).toBe("blank");
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    expect(screen.queryByRole("heading", { name: "Start a skill" })).toBeNull();
    await userEvent.click(report);
    expect(onOpen).toHaveBeenLastCalledWith("s1");
  });

  it("offers to start another when there are some, and says why they could not be read", async () => {
    const first = setup();
    await userEvent.click(await screen.findByRole("button", { name: "Start a skill" }));
    expect(screen.getByRole("heading", { name: "Start a skill" })).toBeTruthy();
    first.unmount();
    resetSkills();
    setup({}, { "GET /api/v1/skills": reply(503, { detail: "Offline." }) });
    expect(await screen.findByText("Offline.")).toBeTruthy();
  });

  it("shows a skill: what it is for, who made it, its files; opens its card; deletes it when confirmed", async () => {
    const { onOpen } = setup({ skill: "s1" }, { "DELETE /api/v1/skills/s1": (() => {
      let n = 0;
      return () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204));
    })() });
    expect(await screen.findByRole("heading", { name: "report" })).toBeTruthy();
    expect(screen.getByText("Weekly reports.")).toBeTruthy();
    expect(screen.getByText("Made by you")).toBeTruthy();
    expect(screen.getByText("3 files.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Edit SKILL.md" }));
    expect(onOpen).toHaveBeenCalledWith("s1", "SKILL.md");
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    confirm.mockResolvedValue(true);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    await userEvent.click(screen.getByRole("button", { name: "Delete skill" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(null));
  });

  it("says which agents have the skill, each a link to its Skills tab, or that none has it yet", async () => {
    const agents = [{ id: "a1", name: "sky", label: "Sky" }, { id: "a2", name: "plain", label: "plain" }];
    const { unmount } = setup({ skill: "s1" }, { "GET /api/v1/skills/s1/agents": { agents } });
    const sky = await screen.findByRole("link", { name: "Sky" });
    expect(sky.getAttribute("href")).toBe("#/agents/a1/skills");
    expect(screen.getByText(/Agents that have it:/).textContent).toBe("Agents that have it: Sky, plain");
    unmount();
    // None: said; one that cannot be read says nothing.
    setup({ skill: "s1" });
    expect(await screen.findByText(/No agent has it yet/)).toBeTruthy();
  });

  it("says nothing of a skill's agents it could not read, nor of an answer after it was left", async () => {
    let answer: (v: unknown) => void = () => {};
    const { unmount } = setup({ skill: "s1" }, { "GET /api/v1/skills/s1/agents": () => new Promise((r) => (answer = r)) });
    await screen.findByRole("heading", { name: "report" });
    unmount();
    await act(async () => answer({ agents: [{ id: "a1", name: "sky", label: "Sky" }] }));
    setup({ skill: "s1" }, { "GET /api/v1/skills/s1/agents": reply(503, { detail: "Down." }) });
    await screen.findByRole("heading", { name: "report" });
    await waitFor(() => expect(screen.getByText(/No agent has it yet/)).toBeTruthy());
  });

  it("says when a skill is not there, or while the list is read", async () => {
    let answer: (v: unknown) => void = () => {};
    setup({ skill: "s9" }, { "GET /api/v1/skills": () => new Promise((r) => (answer = r)) });
    expect(screen.getByText("Loading…")).toBeTruthy();
    await act(async () => answer({ skills: [REPORT] }));
    expect(await screen.findByText("This skill is not there any more.")).toBeTruthy();
  });

  it("edits SKILL.md, previews it, saves it — the cloud's reason when it cannot be read — and never deletes it", async () => {
    const { f } = setup({ skill: "s1", file: "SKILL.md" });
    const text = await screen.findByRole("textbox", { name: "The text of SKILL.md" });
    expect(screen.getByText(/The skill's card/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete this file" })).toBeNull();
    expect(hasUnsavedSkillEdits()).toBe(false);
    await userEvent.type(text, "More.");
    expect(hasUnsavedSkillEdits()).toBe(true);
    const success = vi.spyOn(toast, "success").mockImplementation(() => "");
    fireEvent.keyDown(text, { key: "s", metaKey: true });
    await waitFor(() => expect(success).toHaveBeenCalledWith("Saved."));
    expect(f.to("PUT /api/v1/skills/s1/files/SKILL.md")[0].body).toEqual({ content: `${CARD}More.` });
    expect(hasUnsavedSkillEdits()).toBe(false);
    fireEvent.keyDown(text, { key: "s", ctrlKey: true });
    expect(f.to("PUT /api/v1/skills/s1/files/SKILL.md")).toHaveLength(1);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    fireEvent.change(text, { target: { value: "broken" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("SKILL.md starts with a line '---'."));
    fireEvent.change(text, { target: { value: CARD } });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("table", { name: "Page details" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "The text of SKILL.md" })).toBeTruthy();
  });

  it("edits a script with no preview and deletes it when confirmed", async () => {
    let n = 0;
    const { onOpen } = setup({ skill: "s1", file: "scripts/run.py" }, { "DELETE /api/v1/skills/s1/files/scripts/run.py": () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204)) });
    expect(await screen.findByDisplayValue("print(1)")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Preview" })).toBeNull();
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    expect(onOpen).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    await userEvent.click(screen.getByRole("button", { name: "Delete this file" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("s1"));
  });

  it("shows a file that is not text as its size and a download, and says when a file cannot be read", async () => {
    const created = vi.fn(() => "blob:x");
    const revoked = vi.fn();
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const first = setup({ skill: "s1", file: "logo.png" }, { "GET /api/v1/skill-files/f3": () => new Response("png") });
    await act(() => loadSkills());
    expect(await screen.findByText(/This file is not text \(1234 bytes\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(clicked).toHaveBeenCalled());
    expect(revoked).toHaveBeenCalledWith("blob:x");
    first.unmount();
    // A refusal is said; a file the list does not have shows no download.
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    const second = setup({ skill: "s1", file: "logo.png" }, { "GET /api/v1/skill-files/f3": reply(404, { detail: "Skill file not found." }) });
    await userEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Skill file not found."));
    second.unmount();
    const third = setup({ skill: "s1", file: "other.bin" }, { "GET /api/v1/skills/s1/files/other.bin": reply(422, { detail: "Not text." }) });
    expect(await screen.findByText(/This file is not text \(0 bytes\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    third.unmount();
    setup({ skill: "s1", file: "gone.md" }, { "GET /api/v1/skills/s1/files/gone.md": reply(404, { detail: "There is no such file." }) });
    expect(await screen.findByText("There is no such file.")).toBeTruthy();
  });

  it("drops a file's answer that comes after another file was opened", async () => {
    let answer: (v: unknown) => void = () => {};
    const { rerender, props } = setup({ skill: "s1", file: "slow.md" }, { "GET /api/v1/skills/s1/files/slow.md": () => new Promise((r) => (answer = r)) });
    rerender(<SkillsView {...props} file="scripts/run.py" />);
    await screen.findByDisplayValue("print(1)");
    await act(async () => answer({ path: "slow.md", content: "late", size: 4 }));
    expect(screen.queryByDisplayValue("late")).toBeNull();
    rerender(<SkillsView {...props} file="slow.md" />);
    rerender(<SkillsView {...props} file="scripts/run.py" />);
    await act(async () => answer(reply(500, { detail: "late failure" })));
    expect(screen.queryByText("late failure")).toBeNull();
  });

  it("takes Wysebee Assistant for the open file, and follows the AI app to a skill it made", async () => {
    let polls = 0;
    const { onOpen, f } = setup({ skill: "s1", file: "SKILL.md" }, {
      "POST /api/v1/skills/s1/assistant": { on: true, url: "https://x/assistant/mcp", path: "SKILL.md", revision: 1, writer: "person" },
    });
    f.set(/^GET \/api\/v1\/skills\/s1\/assistant\?/, () =>
      ++polls === 1 ? { on: false, url: "https://x/assistant/mcp", opened: { skill_id: "s7", path: "SKILL.md" } } : new Promise(() => {}),
    );
    await screen.findByRole("textbox", { name: "The text of SKILL.md" });
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("s7", "SKILL.md"));
    expect(f.to("POST /api/v1/skills/s1/assistant")[0].body).toEqual({ path: "SKILL.md", content: CARD });
  });
});
