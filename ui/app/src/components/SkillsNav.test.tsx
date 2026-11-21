import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { resetSkills } from "../skills";
import { SkillsNav } from "./SkillsNav";
import { useFetchTransport } from "../../../test/transport";
import { dialogs } from "./common/confirm";

// Uploads go straight to Wysebee Cloud, signed (cloud/data.ts).
vi.mock("../cloud/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cloud/auth")>()), accessToken: async () => "tok", reauthenticate: async () => {} }));

const skill = (id: string, name: string, files: { path: string; size: number }[] = [{ path: "SKILL.md", size: 9 }], folders: string[] = []) => ({
  id,
  name,
  description: `${name}.`,
  files,
  folders,
  updated_at: null,
});
const REPORT = skill("s1", "report", [{ path: "SKILL.md", size: 9 }, { path: "scripts/run.py", size: 5 }], ["empty"]);

beforeEach(() => {
  resetSkills();
  vi.restoreAllMocks();
});

useFetchTransport();

function setup(selectedSkill: string | null = null, selectedFile: string | null = null, routes: Record<string, unknown> = {}) {
  const f = mockFetch({
    "GET /api/v1/skills": { skills: [REPORT, skill("s2", "notes")] },
    "POST /api/v1/skills": (r: FakeRequest) =>
      (r.body as { name: string }).name === "taken" ? reply(409, { detail: "There is already a skill named 'taken'." }) : reply(201, skill("s3", (r.body as { name: string }).name)),
    ...routes,
  });
  const onSelect = vi.fn();
  function Harness() {
    const [at, setAt] = useState<[string | null, string | null]>([selectedSkill, selectedFile]);
    return (
      <SkillsNav
        selectedSkill={at[0]}
        selectedFile={at[1]}
        onSelect={(s, file) => {
          onSelect(...(file === undefined ? [s] : [s, file]));
          setAt([s, file ?? null]);
        }}
      />
    );
  }
  return { f, onSelect, ...render(<Harness />) };
}

describe("SkillsNav", () => {
  it("has All skills first, marked when none is open, opening their list", async () => {
    const { onSelect } = setup("s2");
    const all = screen.getByRole("button", { name: "All skills" });
    expect(all.getAttribute("aria-current")).toBeNull();
    await screen.findByRole("button", { name: "notes" });
    await userEvent.click(all);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "All skills" }).getAttribute("aria-current")).toBe("page"));
  });

  it("lists the skills and opens one into its files and folders", async () => {
    const { onSelect } = setup();
    expect(screen.getByText("Loading…")).toBeTruthy();
    const report = await screen.findByRole("button", { name: "report" });
    await userEvent.click(report);
    expect(onSelect).toHaveBeenCalledWith("s1");
    // Folders first, then files; a folder made that holds no file yet is listed too.
    const scripts = screen.getByRole("button", { name: "scripts" });
    expect(screen.getByRole("button", { name: "empty" })).toBeTruthy();
    await userEvent.click(scripts);
    await userEvent.click(screen.getByRole("button", { name: "run.py" }));
    expect(onSelect).toHaveBeenLastCalledWith("s1", "scripts/run.py");
    expect(screen.getByRole("button", { name: "run.py" }).getAttribute("aria-current")).toBe("page");
    await userEvent.click(scripts);
    expect(screen.queryByRole("button", { name: "run.py" })).toBeNull();
    // With a file open, the skill's row opens its overview; shown already, it folds away and out.
    await userEvent.click(report);
    expect(onSelect).toHaveBeenLastCalledWith("s1");
    expect(report.getAttribute("aria-current")).toBe("page");
    await userEvent.click(report);
    expect(screen.queryByRole("button", { name: "SKILL.md" })).toBeNull();
    await userEvent.click(report);
    expect(screen.getByRole("button", { name: "SKILL.md" })).toBeTruthy();
  });

  it("says when there are none, or when they could not be read", async () => {
    mockFetch({ "GET /api/v1/skills": { skills: [] } });
    const { unmount } = render(<SkillsNav selectedSkill={null} selectedFile={null} onSelect={vi.fn()} />);
    expect(await screen.findByText("No skills yet.")).toBeTruthy();
    unmount();
    resetSkills();
    mockFetch({ "GET /api/v1/skills": reply(503, { detail: "Offline." }) });
    render(<SkillsNav selectedSkill={null} selectedFile={null} onSelect={vi.fn()} />);
    expect(await screen.findByText("Offline.")).toBeTruthy();
  });

  it("starts a skill and opens its SKILL.md", async () => {
    const { onSelect } = setup();
    await screen.findByRole("button", { name: "report" });
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    await userEvent.click(screen.getByRole("button", { name: "Start a skill" }));
    const input = screen.getByRole("textbox", { name: "Skill name" });
    await userEvent.type(input, "taken{Enter}");
    await waitFor(() => expect(error).toHaveBeenCalledWith("There is already a skill named 'taken'."));
    await userEvent.clear(input);
    await userEvent.type(input, "weekly{Enter}");
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s3", "SKILL.md"));
    expect(await screen.findByRole("button", { name: "weekly" })).toBeTruthy();
    // Empty: the form just closes; Escape and a blur with nothing typed close it too; a name typed stays.
    await userEvent.click(screen.getByRole("button", { name: "Start a skill" }));
    fireEvent.submit(screen.getByRole("textbox", { name: "Skill name" }).closest("form")!);
    expect(screen.queryByRole("textbox", { name: "Skill name" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start a skill" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Skill name" }), "x{Escape}");
    expect(screen.queryByRole("textbox", { name: "Skill name" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start a skill" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Skill name" }));
    expect(screen.queryByRole("textbox", { name: "Skill name" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Start a skill" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Skill name" }), "kept");
    fireEvent.blur(screen.getByRole("textbox", { name: "Skill name" }));
    expect(screen.getByRole("textbox", { name: "Skill name" })).toBeTruthy();
  });

  it("renames a skill in place from its pencil", async () => {
    const { f } = setup(null, null, {
      "PUT /api/v1/skills/s1": (r: FakeRequest) =>
        (r.body as { name: string }).name === "notes" ? reply(409, { detail: "There is already a skill named 'notes'." }) : skill("s1", (r.body as { name: string }).name),
    });
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    await screen.findByRole("button", { name: "report" });
    const pencil = () => screen.getByRole("button", { name: "Rename report" });
    const field = () => screen.getByRole("textbox", { name: "Rename report" }) as HTMLInputElement;
    await userEvent.click(pencil());
    expect(field().value).toBe("report");
    await userEvent.clear(field());
    await userEvent.type(field(), "notes{Enter}");
    await waitFor(() => expect(error).toHaveBeenCalledWith("There is already a skill named 'notes'."));
    await userEvent.type(field(), "{Escape}");
    await userEvent.click(pencil());
    fireEvent.submit(field().closest("form")!);
    await userEvent.click(pencil());
    await userEvent.clear(field());
    fireEvent.blur(field());
    expect(f.to("PUT /api/v1/skills/s1")).toHaveLength(1);
    await userEvent.click(pencil());
    await userEvent.clear(field());
    await userEvent.type(field(), "weekly-report{Enter}");
    expect(await screen.findByRole("button", { name: "weekly-report" })).toBeTruthy();
  });

  it("adds a file, a folder or files from the computer from a + menu", async () => {
    let folders = 0;
    const withFile = skill("s1", "report", [...REPORT.files, { path: "scripts/a.py", size: 1 }, { path: "scripts/notes.md", size: 8 }], ["empty", "scripts/lib"]);
    const { f, onSelect } = setup("s1", null, {
      "PUT /api/v1/skills/s1/files/scripts/a.py": withFile,
      "PUT /api/v1/skills/s1/files/scripts/notes.md": withFile,
      "POST /api/v1/skills/s1/folders/scripts/lib": () => (++folders === 1 ? reply(500, { detail: "No room." }) : reply(201, withFile)),
      "POST /api/v1/skills/s1/folders/top": withFile,
      "PUT /api/v1/skills/s1/files/scripts/data.bin": withFile,
      "PUT /api/v1/skills/s1/files/x.bin": reply(413, { detail: "Too big." }),
      "PUT /api/v1/skills/s1/files/y.txt": withFile,
      "PUT /api/v1/skills/s1/files/z.txt": withFile,
    });
    await screen.findByRole("button", { name: "scripts" });
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    const toastOk = vi.spyOn(toast, "success").mockImplementation(() => "");
    const plus = screen.getByRole("button", { name: "Add to scripts" });
    // The menu opens and closes: by its +, by Escape, by a click elsewhere.
    await userEvent.click(plus);
    expect(screen.getByRole("menu", { name: "Add to scripts" })).toBeTruthy();
    await userEvent.click(plus);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(plus);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(plus);
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "New file" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    // A script keeps its name and starts empty; a page gets ".md" and its title; each opens.
    await userEvent.click(plus);
    await userEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), "a.py{Enter}");
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s1", "scripts/a.py"));
    expect(f.to("PUT /api/v1/skills/s1/files/scripts/a.py")[0].body).toEqual({ content: "\n" });
    await userEvent.click(screen.getByRole("button", { name: "Add to scripts" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), "notes{Enter}");
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s1", "scripts/notes.md"));
    expect(f.to("PUT /api/v1/skills/s1/files/scripts/notes.md")[0].body).toEqual({ content: "# notes\n" });

    // A folder: a refusal is said and the name kept; then it is made.
    await userEvent.click(screen.getByRole("button", { name: "Add to scripts" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "lib{Enter}");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No room."));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "{Enter}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull());
    // At the skill's top, from its own +.
    await userEvent.click(screen.getByRole("button", { name: "Add to report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New folder" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Folder name" }), "top{Enter}");
    await waitFor(() => expect(f.to("POST /api/v1/skills/s1/folders/top")).toHaveLength(1));

    // Nothing named: Enter, Escape or leaving the box puts it away; a name typed stays.
    for (const leave of ["{Enter}", "{Escape}", "blur"]) {
      await userEvent.click(screen.getByRole("button", { name: "Add to scripts" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "New file" }));
      const box = screen.getByRole("textbox", { name: "File name" });
      if (leave === "blur") fireEvent.blur(box);
      else await userEvent.type(box, leave === "{Escape}" ? "x{Escape}" : leave);
      expect(screen.queryByRole("textbox", { name: "File name" })).toBeNull();
    }
    await userEvent.click(screen.getByRole("button", { name: "Add to scripts" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New file" }));
    await userEvent.type(screen.getByRole("textbox", { name: "File name" }), "kept");
    fireEvent.blur(screen.getByRole("textbox", { name: "File name" }));
    expect(screen.getByRole("textbox", { name: "File name" })).toBeTruthy();

    // Files from the computer, into the folder; a refusal is said; nothing chosen, nothing sent.
    const picker = screen.getByTestId("skill-upload") as HTMLInputElement;
    const clicked = vi.spyOn(picker, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Add to scripts" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Upload files…" }));
    expect(clicked).toHaveBeenCalled();
    fireEvent.change(picker, { target: { files: [new File(["\x00"], "data.bin")] } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Uploaded 1 file(s)."));
    await userEvent.click(screen.getByRole("button", { name: "Add to report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Upload files…" }));
    fireEvent.change(picker, { target: { files: [new File(["x"], "x.bin")] } });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Too big."));
    await userEvent.click(screen.getByRole("button", { name: "Add to report" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Upload files…" }));
    fireEvent.change(picker, { target: { files: [new File(["y"], "y.txt"), new File(["z"], "z.txt")] } });
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith("Uploaded 2 file(s)."));
    fireEvent.change(picker, { target: { files: [] } });
    expect(f.calls.filter((c) => c.method === "PUT" && /\.(bin|txt)$/.test(c.path))).toHaveLength(4);
  });

  it("chooses nothing when no + menu asked for files", async () => {
    const { f } = setup("s1");
    await screen.findByRole("button", { name: "scripts" });
    fireEvent.change(screen.getByTestId("skill-upload"), { target: { files: [new File(["x"], "x.bin")] } });
    expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("deletes a folder or a file when confirmed, never SKILL.md", async () => {
    let n = 0;
    const { onSelect } = setup("s1", "scripts/run.py", {
      "DELETE /api/v1/skills/s1/folders/scripts": () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204)),
      "DELETE /api/v1/skills/s1/folders/empty": reply(204),
      "DELETE /api/v1/skills/s1/files/scripts/run.py": reply(204),
      "GET /api/v1/skills/s1": REPORT,
    });
    await screen.findByRole("button", { name: "scripts" });
    expect(screen.queryByRole("button", { name: "Delete SKILL.md" })).toBeNull();
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    const del = screen.getByRole("button", { name: "Delete the folder scripts" });
    await userEvent.click(del);
    expect(onSelect).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    await userEvent.click(del);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    // A folder away from the open file: the file stays open.
    await userEvent.click(screen.getByRole("button", { name: "Delete the folder empty" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(del);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s1"));
  });

  it("deletes a file, leaving the open one only when it was it", async () => {
    let n = 0;
    const { onSelect } = setup("s1", "scripts/run.py", {
      "DELETE /api/v1/skills/s1/files/scripts/run.py": () => (++n === 1 ? reply(500, { detail: "Boom." }) : reply(204)),
      "GET /api/v1/skills/s1": REPORT,
    });
    await userEvent.click(await screen.findByRole("button", { name: "scripts" }));
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    const toastError = vi.spyOn(toast, "error").mockImplementation(() => "");
    const del = within(screen.getByRole("button", { name: "run.py" }).closest("li")!).getByRole("button", { name: "Delete scripts/run.py" });
    await userEvent.click(del);
    confirm.mockResolvedValue(true);
    await userEvent.click(del);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Boom."));
    await userEvent.click(del);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("s1"));
  });

  it("deletes a file not open without leaving the one that is", async () => {
    const { onSelect } = setup("s1", "SKILL.md", { "DELETE /api/v1/skills/s1/files/scripts/run.py": reply(204), "GET /api/v1/skills/s1": REPORT });
    await userEvent.click(await screen.findByRole("button", { name: "scripts" }));
    vi.spyOn(dialogs, "confirm").mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete scripts/run.py" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "run.py" })).toBeTruthy());
    expect(onSelect).not.toHaveBeenCalled();
  });
});
