import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { RunsTab } from "./Runs";

useFetchTransport();

const run = (id: string, over: Record<string, unknown> = {}) => ({ id, task_id: "t1", status: "succeeded", trigger: "manual", agent: null, model: null, started_at: "2026-10-24T09:00:00Z", finished_at: null, output: null, error: null, ...over });

describe("RunsTab", () => {
  it("lists a task's runs and opens one: its report and its steps", async () => {
    mockFetch({
      "GET /api/v1/tasks/t1/runs?limit=20": { rows: [run("r1"), run("r2", { status: "failed", trigger: "schedule", started_at: null })] },
      "GET /api/v1/tasks/t1/runs/r1": run("r1", { output: "All **done**", messages: [{ role: "assistant", content: "Looking.", tool_calls: [] }, { role: "assistant", content: "", tool_calls: [{ id: "c", name: "browser_tabs", arguments: {} }] }, { role: "tool", tool_call_id: "c", name: "browser_tabs", content: "[]", is_error: false }] }),
      "GET /api/v1/tasks/t1/runs/r2": run("r2", { status: "failed", error: "No browser." }),
    });
    render(<RunsTab taskId="t1" />);
    expect(await screen.findByText("Scheduled")).toBeTruthy();
    expect(screen.getByText("Started by hand")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(await screen.findByText("done")).toBeTruthy();
    expect(screen.getByText("browser_tabs")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button")[1]);
    expect(await screen.findByText("No browser.")).toBeTruthy();
  });

  it("says when there are none, and why they could not be read", async () => {
    const f = mockFetch({ "GET /api/v1/tasks/t1/runs?limit=20": { rows: [] } });
    const { unmount } = render(<RunsTab taskId="t1" />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
    unmount();
    f.set("GET /api/v1/tasks/t1/runs?limit=20", { rows: [run("r1")] });
    f.set("GET /api/v1/tasks/t1/runs/r1", reply(404, { detail: "No such run." }));
    render(<RunsTab taskId="t1" />);
    await userEvent.click(await screen.findByRole("button"));
    expect(await screen.findByText("No such run.")).toBeTruthy();
  });

  it("shows a list that failed", async () => {
    mockFetch({ "GET /api/v1/tasks/t1/runs?limit=20": reply(503, { detail: "Cloud down" }) });
    render(<RunsTab taskId="t1" />);
    expect(await screen.findByText(/Cloud down/)).toBeTruthy();
  });
});
