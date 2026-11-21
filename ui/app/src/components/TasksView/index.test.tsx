import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import type { AgentDetail, Task, TaskRunStatus } from "../../api";
import { StatusBadge, TasksView } from "./index";

// The agent page is another area's; a stub hands the test its props.
interface PanelProps {
  detail: AgentDetail;
  tabs: ReadonlyArray<readonly [string, string]>;
  onSave: (config: Record<string, unknown>) => Promise<AgentDetail>;
  onDelete: () => Promise<void>;
  onTabChange: (tab: string) => void;
  extraTabs: Record<string, () => unknown>;
}
const panel: { props: PanelProps | null } = { props: null };
vi.mock("../AgentsView/AgentConfigPanel", () => ({
  AgentConfigPanel: (props: PanelProps) => {
    panel.props = props;
    return <div>panel</div>;
  },
}));

const BASE = "/api/v1/tasks/t1";

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    name: "daily",
    prompt: "do it",
    description: "",
    label: "",
    browser_access: true,
    browser: "",
    browser_devtools: false,
    trigger: { type: "manual" },
    next_run_at: null,
    creator: null,
    created_at: null,
    updated_at: null,
    last_run: null,
    ...over,
  };
}

const lastRun = (status: TaskRunStatus) =>
  ({
    id: "r1",
    task_id: "t1",
    status,
    trigger: "manual",
    agent: null,
    model: null,
    started_at: null,
    finished_at: null,
    output: null,
    error: null,
  }) as Task["last_run"];

const props = (over: Partial<Parameters<typeof TasksView>[0]> = {}) => ({
  rows: [task()] as Task[] | null,
  selected: null as string | null,
  tab: null,
  creating: false,
  meRole: "AGENT_ADMIN" as const,
  currentUserEmail: "me@x",
  onSelect: vi.fn(),
  onTabChange: vi.fn(),
  onChanged: vi.fn(),
  onCreate: vi.fn(),
  ...over,
});

useFetchTransport();

describe("TasksView list", () => {
  it("shows loading, then an empty list", () => {
    mockFetch();
    const { rerender } = render(<TasksView {...props({ rows: null })} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    rerender(<TasksView {...props({ rows: [] })} />);
    expect(screen.getByText("No tasks yet.")).toBeTruthy();
  });

  it("lists tasks by name with their last outcome, opens one, and offers Add only to editors", async () => {
    mockFetch();
    const p = props({
      rows: [
        task({ id: "c", name: "gamma", prompt: "plan text", last_run: lastRun("failed") }),
        task({ id: "a", name: "alpha", label: "  ", prompt: "", description: "" }),
        task({ id: "b", name: "zed", label: "Beta", description: "desc", trigger: { type: "once" } }),
      ],
      selected: "missing",
    });
    const { rerender } = render(<TasksView {...p} />);
    // Sorted by what is shown: a blank label falls back to the name.
    expect(screen.getAllByRole("button").map((b) => b.textContent?.split(/No plan|desc|plan text/)[0])).toEqual([
      "Add Task",
      "alpha",
      "Beta",
      "gamma",
    ]);
    expect(screen.getByText("No plan yet")).toBeTruthy();
    expect(screen.getByText("desc")).toBeTruthy();
    expect(screen.getByText("plan text")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getAllByText("Not run yet")).toHaveLength(2);
    // Nothing runs on the web: no Start.
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    await userEvent.click(screen.getByText("Beta"));
    expect(p.onSelect).toHaveBeenCalledWith("b");
    await userEvent.click(screen.getByRole("button", { name: "Add Task" }));
    expect(p.onCreate).toHaveBeenCalled();
    rerender(<TasksView {...p} meRole="AGENT_READER" />);
    expect(screen.queryByRole("button", { name: "Add Task" })).toBeNull();
  });
});

describe("TasksView create", () => {
  it("asks for a name, creates, and opens the plan", async () => {
    const f = mockFetch({ "POST /api/v1/tasks": task({ id: "new" }) });
    const p = props({ creating: true });
    render(<TasksView {...p} />);
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByText("Give the task a name.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Name"), "  New one ");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith("new", "plan"));
    expect(f.to("POST /api/v1/tasks")[0].body).toEqual({ name: "New one" });
    expect(p.onChanged).toHaveBeenCalled();
  });

  it("shows a refusal, and cancels", async () => {
    const f = mockFetch({ "POST /api/v1/tasks": reply(500, { detail: "taken" }) });
    const p = props({ creating: true });
    render(<TasksView {...p} />);
    await userEvent.type(screen.getByLabelText("Name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByText(/taken/)).toBeTruthy();
    f.set("POST /api/v1/tasks", () => {
      throw "odd";
    });
    await userEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(await screen.findByText("odd")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(p.onSelect).toHaveBeenCalledWith(null);
  });
});

describe("TasksView task page", () => {
  it("maps the task to the agent page, with the web's tabs, and saves back", async () => {
    const saved = task({ label: "L", browser: "chrome", browser_devtools: true, browser_access: false, creator: "me" });
    const f = mockFetch({ [`PUT ${BASE}`]: saved });
    const p = props({
      selected: "t1",
      rows: [task({ label: "Lbl", browser: "edge", browser_devtools: true, browser_access: false })],
    });
    render(<TasksView {...p} />);
    expect(screen.getByRole("heading", { name: "Lbl" })).toBeTruthy();
    expect(panel.props!.tabs.map(([k]) => k)).toEqual(["property", "plan", "run"]);
    // Its runs, drawn by the task's page.
    expect(panel.props!.extraTabs.run()).toBeTruthy();
    expect(panel.props!.detail.config).toEqual({
      instructions: "do it",
      label: "Lbl",
      browser_access: false,
      browser: "edge",
      browser_devtools: true,
    });
    let back: AgentDetail | undefined;
    await act(async () => {
      back = await panel.props!.onSave({ label: 3, instructions: "p", skills: ["x"], browser_access: false, browser_devtools: true });
    });
    expect(f.to(`PUT ${BASE}`)[0].body).toEqual({
      label: "",
      prompt: "p",
      browser_access: false,
      browser: "",
      browser_devtools: true,
    });
    expect(back!.config).toEqual({
      instructions: "do it",
      label: "L",
      browser_access: false,
      browser: "chrome",
      browser_devtools: true,
    });
    expect(back!.creator).toBe("me");
    await act(async () => {
      await panel.props!.onSave({});
    });
    expect(f.to(`PUT ${BASE}`)[1].body).toMatchObject({ browser_access: true, browser_devtools: false });
    act(() => panel.props!.onTabChange("plan"));
    expect(p.onTabChange).toHaveBeenCalledWith("plan");
  });

  it("shows the task's name when it has no label", () => {
    mockFetch();
    render(<TasksView {...props({ selected: "t1" })} />);
    expect(screen.getByRole("heading", { name: "daily" })).toBeTruthy();
  });

  it("deletes the task and goes back to the list", async () => {
    mockFetch({ [`DELETE ${BASE}`]: reply(204) });
    const p = props({ selected: "t1" });
    render(<TasksView {...p} />);
    await act(async () => {
      await panel.props!.onDelete();
    });
    expect(p.onSelect).toHaveBeenCalledWith(null);
    expect(p.onChanged).toHaveBeenCalled();
  });
});

describe("StatusBadge", () => {
  it("names every status", () => {
    render(
      <>
        <StatusBadge status={null} />
        <StatusBadge status="interrupted" />
        <StatusBadge status="stopped" />
        <StatusBadge status="running" />
        <StatusBadge status="succeeded" />
      </>,
    );
    for (const text of ["Not run yet", "Interrupted", "Stopped", "Running", "Done"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });
});
