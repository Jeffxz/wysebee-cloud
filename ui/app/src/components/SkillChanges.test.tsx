import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { resetSkills } from "../skills";
import { CHANGES_REFRESH_MS, SkillChanges } from "./SkillChanges";

useFetchTransport();
// Skills are forwarded to Wysebee Cloud, signed (cloud/forward.ts).
vi.mock("../cloud/auth", async (importOriginal) => ({ ...(await importOriginal<typeof import("../cloud/auth")>()), accessToken: async () => "tok", reauthenticate: async () => {} }));

const SKILL = { id: "s1", name: "report", description: "R.", files: [], folders: [], updated_at: null };
const change = (id: string, path: string, over: Record<string, unknown> = {}) => ({ id, path, folder: false, size: 3, new: true, created_at: "2026-11-17T00:00:00Z", ...over });
const BASE = "/api/v1/skills/s1/changes";

beforeEach(() => {
  resetSkills();
  vi.restoreAllMocks();
});

function setup(waiting: ReturnType<typeof change>[]) {
  let left = [...waiting];
  const onApplied = vi.fn();
  const f = mockFetch([
    [`GET ${BASE}`, () => ({ changes: left })],
    [/^GET \/api\/v1\/skills\/s1\/changes\/c1$/, { ...waiting[0], content: "print(2)", current: "print(1)" }],
    [/^GET \/api\/v1\/skills\/s1\/changes\/c2$/, { ...waiting[1], content: "new", current: null }],
    [/^GET \/api\/v1\/skills\/s1\/changes\/gone$/, reply(404, { detail: "There is no such change: it was applied or discarded." })],
    [
      /^POST \/api\/v1\/skills\/s1\/changes\/(\w+)\/apply$/,
      (r: FakeRequest) => {
        const id = r.path.split("/")[6];
        if (id === "bad") return reply(413, { detail: "A skill file is at most 10 bytes." });
        left = left.filter((c) => c.id !== id);
        return SKILL;
      },
    ],
    [
      /^DELETE \/api\/v1\/skills\/s1\/changes\/\w+$/,
      (r: FakeRequest) => {
        left = left.filter((c) => c.id !== r.path.split("/").pop());
        return reply(204);
      },
    ],
  ]);
  render(<SkillChanges skillId="s1" onApplied={onApplied} />);
  return { f, onApplied };
}

describe("SkillChanges", () => {
  it("shows nothing when no change waits", async () => {
    const { f } = setup([]);
    await waitFor(() => expect(f.to(`GET ${BASE}`)).toHaveLength(1));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("lists what the AI app proposed, shows it beside the file now, and applies or discards each", async () => {
    const { f, onApplied } = setup([change("c1", "scripts/run.py", { new: false }), change("c2", "notes.md"), change("c3", "refs", { folder: true })]);
    const panel = await screen.findByRole("region", { name: "Changes proposed by your AI app" });
    expect(within(panel).getByText(/Not saved/)).toBeTruthy();
    expect(within(panel).getByText("Changes a file")).toBeTruthy();
    expect(within(panel).getByText("New file")).toBeTruthy();
    expect(within(panel).getByText("New folder")).toBeTruthy();
    // A folder has nothing to view.
    expect(within(panel).getAllByRole("button", { name: "View" })).toHaveLength(2);
    // Viewed: the proposal beside the file as it is now; hidden again.
    await userEvent.click(within(panel).getAllByRole("button", { name: "View" })[0]);
    expect(await within(panel).findByText("print(1)")).toBeTruthy();
    expect(within(panel).getByText("print(2)")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Hide" }));
    expect(within(panel).queryByText("print(2)")).toBeNull();
    // A new file: only the proposal.
    await userEvent.click(within(panel).getAllByRole("button", { name: "View" })[1]);
    expect(await within(panel).findByText("new")).toBeTruthy();
    expect(within(panel).queryByText("Now")).toBeNull();
    // Applied: saved into the skill, and said to the editor.
    await userEvent.click(within(panel).getByRole("button", { name: "Apply scripts/run.py" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalledWith("scripts/run.py"));
    expect(f.to("POST /api/v1/skills/s1/changes/c1/apply")).toHaveLength(1);
    // Discarded: gone, nothing applied.
    await userEvent.click(await screen.findByRole("button", { name: "Discard notes.md" }));
    await waitFor(() => expect(screen.queryByText("notes.md")).toBeNull());
    expect(onApplied).toHaveBeenCalledTimes(1);
    // The last one: no "Apply all" for one.
    expect(screen.queryByRole("button", { name: /Apply all/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Apply refs" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
  });

  it("applies them all at once, stopping at one that fails, and says why", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { onApplied } = setup([change("c1", "a.md"), change("bad", "big.md"), change("c2", "c.md")]);
    await userEvent.click(await screen.findByRole("button", { name: "Apply all 3" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("A skill file is at most 10 bytes."));
    expect(onApplied.mock.calls).toEqual([["a.md"]]);
    expect(await screen.findByText("big.md")).toBeTruthy();
    // One that fails alone says why too, and stays.
    await userEvent.click(screen.getByRole("button", { name: "Apply big.md" }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    expect(screen.getByText("big.md")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply all 2" }));
    await waitFor(() => expect(error).toHaveBeenCalledTimes(3));
  });

  it("says why a change cannot be viewed, and reads them again while the page shows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { f } = setup([change("gone", "old.md")]);
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("There is no such change: it was applied or discarded."));
    const before = f.to(`GET ${BASE}`).length;
    await act(async () => void vi.advanceTimersByTime(CHANGES_REFRESH_MS));
    await waitFor(() => expect(f.to(`GET ${BASE}`).length).toBeGreaterThan(before));
    vi.useRealTimers();
  });
});
