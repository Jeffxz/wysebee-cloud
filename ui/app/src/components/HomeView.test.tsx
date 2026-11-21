import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { loadAgents, resetAgents } from "../agents";
import { resetPresence } from "../presence";
import { loadWorkspaces, resetWorkspaces } from "../workspaces";
import type { Task } from "../api";
import { HomeView, SHOWN } from "./HomeView";
import { useFetchTransport } from "../../../test/transport";

useFetchTransport();

beforeEach(() => {
  resetAgents();
  resetPresence();
  resetWorkspaces();
});

const AGENTS = {
  rows: [
    { id: "w", agent_name: "wysebee", label: "Wysebee", updated_at: null },
    { id: "a1", agent_name: "scout", label: "Scout", browser: true, updated_at: null },
    { id: "a2", agent_name: "studio", label: "Studio", device: "wysebee-osx", updated_at: null },
  ],
};
const LINKS = {
  links: [
    { id: "l1", agent: "scout", label: "Scout", browser: "Chrome", kind: "browser", status: "connected", paused: false, agent_type: { id: "t1", key: "wysebee-browser-chrome", name: "Wysebee Browser Agent" } },
    { id: "l2", agent: "studio", label: "Studio", browser: "Studio Mac", kind: "osx", status: "offline", paused: false, agent_type: { id: "t2", key: "wysebee-osx", name: "Wysebee OSX Agent" } },
    { id: "l3", agent: "pc", label: "PC", browser: "Desk PC", kind: "osx", status: "connected", paused: true, agent_type: { id: "t3", key: "wysebee-windows", name: "Wysebee Windows Agent" } },
  ],
};
const WORKSPACES = {
  workspaces: [
    { id: "p2", name: "Website", resource_url: "x", updated_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
    { id: "p1", name: "Docs", resource_url: "x", updated_at: null },
  ],
};
const task = (id: string, name: string, more: Partial<Task> = {}) =>
  ({ id, name, label: "", prompt: "", description: "", trigger: { type: "manual" }, last_run: null, ...more }) as Task;
const TASKS = [
  task("t2", "weekly", { label: "Weekly report", description: "Sums up the week.", trigger: { type: "recurring" } as Task["trigger"], last_run: { status: "succeeded" } as Task["last_run"] }),
  task("t1", "digest", { prompt: "Read the news." }),
];

function setup(tasks: Task[] | null = TASKS, routes: Record<string, unknown> = {}) {
  const f = mockFetch({ "GET /agent/agents": AGENTS, "GET /api/v1/browser-links": LINKS, "GET /api/v1/workspaces": WORKSPACES, ...routes });
  const props = { onOpenWorkspace: vi.fn(), onOpenAgent: vi.fn(), onOpenTask: vi.fn(), onOpenDevice: vi.fn(), onView: vi.fn(), onNew: vi.fn() };
  const utils = render(<HomeView tasks={tasks} {...props} />);
  return { f, props, ...utils };
}

const rowsOf = (section: HTMLElement) => within(section).getAllByRole("listitem").map((li) => li.textContent);

describe("HomeView", () => {
  it("puts Workspaces above Agents on the left, Tasks above Devices on the right", async () => {
    setup();
    const sections = (await screen.findAllByRole("region")).map((r) => r.getAttribute("aria-label"));
    expect(sections).toEqual(["Workspaces", "Agents", "Tasks", "Devices"]);
    const column = (name: string) => screen.getByRole("region", { name }).parentElement;
    expect(column("Agents")).toBe(column("Workspaces"));
    expect(column("Devices")).toBe(column("Tasks"));
    expect(column("Workspaces")).not.toBe(column("Tasks"));
  });

  it("lists the workspaces, each opening it, with when it changed", async () => {
    const { props } = setup();
    const workspaces = screen.getByRole("region", { name: "Workspaces" });
    expect(await within(workspaces).findByText("Website")).toBeTruthy();
    expect(rowsOf(workspaces)).toEqual(["Docs", "WebsiteChanged 2 hours ago"]);
    expect(within(workspaces).getByRole("heading").textContent).toBe("Workspaces2");
    await userEvent.click(within(workspaces).getByRole("button", { name: /Website/ }));
    expect(props.onOpenWorkspace).toHaveBeenCalledWith("p2");
    await userEvent.click(within(workspaces).getByRole("button", { name: "View all workspaces" }));
    expect(props.onView).toHaveBeenLastCalledWith("workspaces");
  });

  it("says when there are no workspaces or tasks yet, and while tasks are read", async () => {
    const first = setup([], { "GET /api/v1/workspaces": { workspaces: [] } });
    expect(await within(screen.getByRole("region", { name: "Workspaces" })).findByText("No workspaces yet.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Tasks" })).getByText("No tasks yet.")).toBeTruthy();
    first.unmount();
    setup(null);
    const tasks = screen.getByRole("region", { name: "Tasks" });
    expect(within(tasks).getByText("Loading…")).toBeTruthy();
    expect(within(tasks).getByRole("heading").textContent).toBe("Tasks");
  });

  it("lists the agents, each opening its settings, online while its device is", async () => {
    const { props } = setup();
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(await within(agents).findByText("Studio")).toBeTruthy();
    expect(rowsOf(agents)).toEqual(["Wysebee@wysebee", "Scout@scout", "Studio@studio"]);
    expect(within(agents).getByRole("heading").textContent).toBe("Agents3");
    const kinds = within(agents).getAllByRole("img").filter((i) => i.hasAttribute("data-device-kind")).map((i) => i.getAttribute("data-device-kind"));
    expect(kinds).toEqual(["cloud", "chrome", "mac"]);
    // Studio's Mac is offline, so Studio is too.
    await waitFor(() => expect([...agents.querySelectorAll("[data-presence]")].map((e) => e.getAttribute("data-presence"))).toEqual(["online", "online", "offline"]));
    await userEvent.click(within(agents).getByRole("button", { name: /Scout/ }));
    expect(props.onOpenAgent).toHaveBeenCalledWith("a1");
    await userEvent.click(within(agents).getByRole("button", { name: "View all agents" }));
    expect(props.onView).toHaveBeenLastCalledWith("agents");
  });

  it("lists the tasks by name, each with its kind and last run, opening it", async () => {
    const { props } = setup();
    const tasks = screen.getByRole("region", { name: "Tasks" });
    expect(rowsOf(tasks)).toEqual(["digestRead the news.Not run yet", "Weekly reportSums up the week.Done"]);
    expect(within(tasks).getByRole("img", { name: "Recurring" })).toBeTruthy();
    expect(within(tasks).getByRole("heading").textContent).toBe("Tasks2");
    await userEvent.click(within(tasks).getByRole("button", { name: /Weekly report/ }));
    expect(props.onOpenTask).toHaveBeenCalledWith("t2");
    await userEvent.click(within(tasks).getByRole("button", { name: "View all tasks" }));
    expect(props.onView).toHaveBeenLastCalledWith("tasks");
  });

  it("lists the devices, Wysebee Cloud first, each with its status", async () => {
    const { props } = setup();
    const devices = screen.getByRole("region", { name: "Devices" });
    expect(await within(devices).findByText("Desk PC")).toBeTruthy();
    expect(rowsOf(devices)).toEqual([
      "Wysebee CloudWhere every agent runsOnline",
      "ChromeWysebee Browser Agent · ScoutOnline",
      "Studio MacWysebee OSX Agent · StudioOffline",
      "Desk PCWysebee Windows Agent · PCPaused",
    ]);
    expect(within(devices).getByRole("heading").textContent).toBe("Devices4");
    expect(within(devices).getByRole("list").hasAttribute("data-track-private")).toBe(true);
    await userEvent.click(within(devices).getByRole("button", { name: "View all devices" }));
    expect(props.onView).toHaveBeenLastCalledWith("devices");
    // Each opens its page on Devices; Wysebee Cloud's too.
    await userEvent.click(within(devices).getByRole("button", { name: /Desk PC/ }));
    expect(props.onOpenDevice).toHaveBeenLastCalledWith("l3");
    await userEvent.click(within(devices).getByRole("button", { name: /^Wysebee Cloud/ }));
    expect(props.onOpenDevice).toHaveBeenLastCalledWith("cloud");
  });

  it("has a + on Workspaces, Agents and Tasks, none on Devices: a workspace or a task on its page, an agent here", async () => {
    const { f, props } = setup(TASKS, {
      "POST /agent/agents": (r: FakeRequest) => ({ id: "new-id", agent_name: (r.body as { name: string }).name, config: { label: (r.body as { label: string }).label }, system_prompt: "", creator: "", updated_at: null }),
    });
    const region = (name: string) => screen.getByRole("region", { name });
    expect(within(region("Devices")).queryByRole("button", { name: /^(Add|New|Start)/ })).toBeNull();
    await userEvent.click(within(region("Workspaces")).getByRole("button", { name: "Start a workspace" }));
    expect(props.onNew).toHaveBeenLastCalledWith("workspaces");
    await userEvent.click(within(region("Tasks")).getByRole("button", { name: "New task" }));
    expect(props.onNew).toHaveBeenLastCalledWith("tasks");
    // An agent: added in a dialog here, then its settings open.
    await userEvent.click(within(region("Agents")).getByRole("button", { name: "Add an agent" }));
    const dialog = screen.getByRole("dialog", { name: "Add an agent" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Travel Planner");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add agent" }));
    await waitFor(() => expect(props.onOpenAgent).toHaveBeenLastCalledWith("new-id"));
    expect(f.to("POST /agent/agents")[0].body).toEqual({ name: "travel-planner", label: "Travel Planner" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(props.onNew).toHaveBeenCalledTimes(2);
  });

  it(`shows at most ${SHOWN} rows a section, its count saying how many there are`, async () => {
    const many = Array.from({ length: SHOWN + 2 }, (_, i) => task(`t${i}`, `task ${i}`));
    setup(many);
    const tasks = screen.getByRole("region", { name: "Tasks" });
    expect(within(tasks).getAllByRole("listitem")).toHaveLength(SHOWN);
    expect(within(tasks).getByRole("heading").textContent).toBe(`Tasks${SHOWN + 2}`);
  });
  it("says why the workspaces or agents could not be read, until they are", async () => {
    setup(TASKS, { "GET /api/v1/workspaces": reply(502, { detail: "Workspaces are down" }), "GET /agent/agents": reply(500, { detail: "Agents are down" }) });
    const workspaces = screen.getByRole("region", { name: "Workspaces" });
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(await within(workspaces).findByText(/Workspaces are down/)).toBeTruthy();
    expect(await within(agents).findByText(/Agents are down/)).toBeTruthy();
    expect(within(workspaces).queryByText("Loading…")).toBeNull();
    expect(within(agents).queryByText("Loading…")).toBeNull();
  });

  it("keeps the rows it has when reading them again fails", async () => {
    const { f } = setup();
    const workspaces = screen.getByRole("region", { name: "Workspaces" });
    const agents = screen.getByRole("region", { name: "Agents" });
    expect(await within(workspaces).findByText("Website")).toBeTruthy();
    expect(await within(agents).findByText("Studio")).toBeTruthy();
    f.set("GET /api/v1/workspaces", reply(502, { detail: "Workspaces are down" }));
    f.set("GET /agent/agents", reply(500, { detail: "Agents are down" }));
    await act(async () => {
      await loadWorkspaces();
      await loadAgents();
    });
    expect(rowsOf(workspaces)).toEqual(["Docs", "WebsiteChanged 2 hours ago"]);
    expect(rowsOf(agents)).toEqual(["Wysebee@wysebee", "Scout@scout", "Studio@studio"]);
    expect(within(workspaces).queryByText(/Workspaces are down/)).toBeNull();
    expect(within(agents).queryByText(/Agents are down/)).toBeNull();
  });

  it("names a device by its kind or its type when it has no name of its own", async () => {
    setup(TASKS, {
      "GET /api/v1/browser-links": {
        links: [
          // From before kinds: a browser.
          { id: "l4", agent: "old", label: "Old", status: "connected", paused: false },
          // A kind with no type it knows: some other device.
          { id: "l5", agent: "phone", label: "Phone", browser: "", kind: "android", status: "offline", paused: false },
          // A type it has no icon for: some other device, by its type's name.
          { id: "l6", agent: "tablet", label: "Tablet", browser: "", kind: "ios", status: "connected", paused: true, agent_type: { id: "t9", key: "wysebee-ios", name: "Wysebee iOS Agent" } },
        ],
      },
    });
    const devices = screen.getByRole("region", { name: "Devices" });
    expect(await within(devices).findByText("Old", { exact: false })).toBeTruthy();
    expect(rowsOf(devices)).toEqual(["Wysebee CloudWhere every agent runsOnline", "Browser extensionBrowser extension · OldOnline", "PhoneOffline", "Wysebee iOS AgentWysebee iOS Agent · TabletPaused"]);
    const kinds = within(devices).getAllByRole("img").filter((i) => i.hasAttribute("data-device-kind")).map((i) => i.getAttribute("data-device-kind"));
    expect(kinds).toEqual(["chrome", "other", "other"]);
    expect(within(devices).getByRole("img", { name: "Wysebee iOS Agent" })).toBeTruthy();
  });

  it("closes the Add an agent dialog without adding one when cancelled", async () => {
    const { f, props } = setup();
    await userEvent.click(within(screen.getByRole("region", { name: "Agents" })).getByRole("button", { name: "Add an agent" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Add an agent" })).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(f.to("POST /agent/agents")).toHaveLength(0);
    expect(props.onOpenAgent).not.toHaveBeenCalled();
  });
});
