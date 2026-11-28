/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";
import { mockFetch, reply } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import { APP_CHANGED, type RemoteChangeDetail } from "./api";

// Every child view is a stub that records its latest props and how often it mounted,
// so these tests drive App's own routing and wiring; each view has its own tests.
const h = vi.hoisted(() => ({
  props: {} as Record<string, any>,
  mounts: {} as Record<string, number>,
  toast: vi.fn(),
  unsaved: false,
  workspaceEdits: false,
  skillEdits: false,
  workspaces: null as { id: string; name: string }[] | null,
  skills: null as { id: string; name: string }[] | null,
  openActivity: null as (() => void) | null,
}));

function stub(name: string) {
  return function Stub(p: any) {
    h.props[name] = p;
    useEffect(() => {
      h.mounts[name] = (h.mounts[name] ?? 0) + 1;
    }, []);
    return <div data-testid={name} />;
  };
}

vi.mock("./components/SideNav/Sidebar", () => ({ Sidebar: stub("Sidebar") }));
vi.mock("./components/TasksView", () => ({ TasksView: stub("TasksView") }));
vi.mock("./components/TasksNav", () => ({ TasksNav: stub("TasksNav") }));
vi.mock("./components/ActivityView", () => ({ ActivityView: stub("ActivityView") }));
vi.mock("./components/ActivityNav", () => ({ ActivityNav: stub("ActivityNav") }));
vi.mock("./components/ToolsView", () => ({ ToolsView: stub("ToolsView") }));
vi.mock("./components/ToolsNav", () => ({ ToolsNav: stub("ToolsNav") }));
vi.mock("./components/PageView", () => ({ PageView: stub("PageView") }));
vi.mock("./browserNotify", () => ({
  startBrowserNotify: (open: () => void) => {
    h.openActivity = open;
    return () => {};
  },
}));
vi.mock("./components/HomeView", () => ({ HomeView: stub("HomeView") }));
vi.mock("./components/AgentsPage", () => ({
  AgentsPage: stub("AgentsPage"),
  settingsTabFromSegment: (s: string | undefined) => (s === "tools" || s === "instructions" || s === "property" || s === "skills" ? s : null),
}));
vi.mock("./components/AgentsNav", () => ({ AgentsNav: stub("AgentsNav") }));
vi.mock("./components/AgentsList", () => ({ AgentsList: stub("AgentsList") }));
vi.mock("./components/WorkspacesNav", () => ({ WorkspacesNav: stub("WorkspacesNav") }));
vi.mock("./components/WorkspacesView", () => ({ WorkspacesView: stub("WorkspacesView"), hasUnsavedWorkspaceEdits: () => h.workspaceEdits }));
vi.mock("./components/SettingsView", () => ({ SettingsView: stub("SettingsView") }));
vi.mock("./workspaces", () => ({ useWorkspaces: () => ({ items: h.workspaces }) }));
vi.mock("./components/SkillsNav", () => ({ SkillsNav: stub("SkillsNav") }));
vi.mock("./components/SkillsView", () => ({ SkillsView: stub("SkillsView"), hasUnsavedSkillEdits: () => h.skillEdits }));
vi.mock("./skills", () => ({ useSkills: () => ({ items: h.skills }) }));
vi.mock("./components/SettingsView/DevicesView", () => ({ DevicesView: stub("DevicesView") }));
vi.mock("./components/DevicesNav", () => ({ DevicesNav: stub("DevicesNav") }));
vi.mock("./components/DeviceDetail", () => ({ DeviceDetail: stub("DeviceDetail") }));
vi.mock("./components/ProfileView", () => ({
  AccountView: stub("AccountView"),
  accountTabFromSegment: (s: string | undefined) => (s === "billing" ? "billing" : "profile"),
}));
vi.mock("./components/common/autoSave", () => ({ hasUnsavedEdits: () => h.unsaved }));
vi.mock("sonner", () => ({ Toaster: () => null, toast: h.toast }));

import App from "./App";
import { dialogs } from "./components/common/confirm";

const admin = { user_id: "u", email: "me@x", user_role: "AGENT_ADMIN" };
const tasks = { rows: [{ id: "t1", name: "Task one" }] };

function api(over: Record<string, unknown> = {}) {
  return mockFetch({
    "GET /api/v1/config/users/me": admin,
    "GET /api/v1/tasks": tasks,
    ...over,
  });
}

async function go(hash: string) {
  act(() => {
    window.location.hash = hash;
  });
  await waitFor(() => expect(window.location.hash).toBe(hash));
}

/** Render, and wait for the role and the first list to arrive. */
async function renderApp(hash = "#/tasks") {
  if (hash) window.location.hash = hash;
  const r = render(<App />);
  await waitFor(() => expect(h.props.TasksView?.meRole).toBe("AGENT_ADMIN"));
  return r;
}

function changed(detail?: RemoteChangeDetail) {
  act(() => {
    window.dispatchEvent(new CustomEvent(APP_CHANGED, { detail }));
  });
}

useFetchTransport();

beforeEach(() => {
  for (const k of Object.keys(h.props)) delete h.props[k];
  for (const k of Object.keys(h.mounts)) delete h.mounts[k];
  h.toast.mockReset();
  h.unsaved = false;
  h.workspaceEdits = false;
  h.skillEdits = false;
});

describe("App", () => {
  it("opens a page the AI app made at its own address, alone, with none of Wysebee around it", async () => {
    api();
    window.location.hash = "#/pages/pg%201";
    render(<App />);
    await waitFor(() => expect(h.props.PageView).toMatchObject({ pageId: "pg 1" }));
    expect(h.mounts.Sidebar).toBeFalsy();
    expect(h.mounts.WorkspacesNav).toBeFalsy();
    expect(h.mounts.WorkspacesView).toBeFalsy();
    // No id: Workspaces itself.
    await go("#/pages");
    await waitFor(() => expect(h.props.WorkspacesView).toMatchObject({ workspace: null, file: null }));
  });

  it("opens Workspaces, a workspace and a file by their route, and asks before leaving unsaved edits", async () => {
    api();
    window.location.hash = "#/workspaces";
    render(<App />);
    await waitFor(() => expect(h.props.Sidebar.active).toBe("workspaces"));
    expect(screen.getByRole("heading").textContent).toBe("Workspaces");
    expect(h.props.WorkspacesNav).toMatchObject({ selectedWorkspace: null, selectedFile: null });
    expect(h.props.WorkspacesView).toMatchObject({ workspace: null, file: null });
    await act(async () => {
      await h.props.WorkspacesNav.onSelect("p 1", "guide/My Setup.md");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces/p%201?file=guide%2FMy%20Setup.md"));
    await waitFor(() => expect(h.props.WorkspacesView).toMatchObject({ workspace: "p 1", file: "guide/My Setup.md" }));
    // A page open is headed by its workspace's name, once the workspaces are read; until then, Workspaces.
    expect(screen.getByRole("heading").textContent).toBe("Workspaces");
    h.workspaces = [{ id: "p 1", name: "Design Document" }];
    await go("#/workspaces/p%201?file=guide%2FMy%20Setup.md&again=1");
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Design Document"));
    // A folder of it, by its route; a file named too wins.
    await go("#/workspaces/p%201?folder=guide%2Fhow");
    await waitFor(() => expect(h.props.WorkspacesView).toMatchObject({ workspace: "p 1", file: null, folder: "guide/how" }));
    expect(h.props.WorkspacesNav).toMatchObject({ selectedFolder: "guide/how" });
    await act(async () => {
      await h.props.WorkspacesNav.onSelect("p 1", undefined, "notes");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces/p%201?folder=notes"));
    await go("#/workspaces/p%201?file=a.md&folder=notes");
    await waitFor(() => expect(h.props.WorkspacesView).toMatchObject({ file: "a.md", folder: null }));
    // A workspace's own page keeps Workspaces (it shows the name itself).
    await go("#/workspaces/p%201");
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Workspaces"));
    h.workspaces = null;
    // A file named without its workspace means the workspaces alone.
    await go("#/workspaces?file=x.md");
    await waitFor(() => expect(h.props.WorkspacesView).toMatchObject({ workspace: null, file: null }));
    await act(async () => {
      await h.props.WorkspacesView.onOpen("p1");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces/p1"));
    await act(async () => {
      await h.props.WorkspacesView.onOpen(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces"));
    // Edits not saved: asked first, and staying keeps the page.
    h.workspaceEdits = true;
    const ask = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await act(async () => {
      await h.props.WorkspacesNav.onSelect("p2");
    });
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#/workspaces");
    ask.mockResolvedValue(true);
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    await waitFor(() => expect(h.props.Sidebar.active).toBe("tasks"));
    // Elsewhere, nothing is asked.
    await act(async () => {
      await h.props.Sidebar.onSelect("workspaces");
    });
    await waitFor(() => expect(h.props.Sidebar.active).toBe("workspaces"));
    expect(ask).toHaveBeenCalledTimes(3);
    ask.mockRestore();
  });

  it("opens Skills, a skill and a file by their route, asks before leaving unsaved edits, and follows the AI app to a skill it made", async () => {
    api();
    window.location.hash = "#/skills";
    render(<App />);
    await waitFor(() => expect(h.props.Sidebar.active).toBe("skills"));
    expect(screen.getByRole("heading").textContent).toBe("Skills");
    expect(h.props.SkillsNav).toMatchObject({ selectedSkill: null, selectedFile: null });
    expect(h.props.SkillsView).toMatchObject({ skill: null, file: null });
    await act(async () => {
      await h.props.SkillsNav.onSelect("s 1", "scripts/run.py");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/skills/s%201?file=scripts%2Frun.py"));
    await waitFor(() => expect(h.props.SkillsView).toMatchObject({ skill: "s 1", file: "scripts/run.py" }));
    expect(screen.getByRole("heading").textContent).toBe("Skills");
    h.skills = [{ id: "s 1", name: "weekly-report" }];
    await go("#/skills/s%201?file=SKILL.md");
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("weekly-report"));
    await go("#/skills/s%201");
    await waitFor(() => expect(screen.getByRole("heading").textContent).toBe("Skills"));
    h.skills = null;
    await go("#/skills?file=x.md");
    await waitFor(() => expect(h.props.SkillsView).toMatchObject({ skill: null, file: null }));
    await act(async () => {
      await h.props.SkillsView.onOpen("s1");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/skills/s1"));
    await act(async () => {
      await h.props.SkillsView.onOpen(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/skills"));
    // Edits not saved: asked first, and staying keeps the page.
    h.skillEdits = true;
    const ask = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    await act(async () => {
      await h.props.SkillsNav.onSelect("s2");
    });
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(window.location.hash).toBe("#/skills");
    ask.mockResolvedValue(true);
    await act(async () => {
      await h.props.Sidebar.onSelect("workspaces");
    });
    await waitFor(() => expect(h.props.Sidebar.active).toBe("workspaces"));
    h.skillEdits = false;
    // On a workspace's page, the AI app made a skill: the Skills page opens it — asked first
    // when the page holds edits not saved.
    h.workspaceEdits = true;
    ask.mockResolvedValue(false);
    await act(async () => {
      await h.props.WorkspacesView.onOpenSkill("s9", "SKILL.md");
    });
    expect(window.location.hash).toBe("#/workspaces");
    ask.mockResolvedValue(true);
    await act(async () => {
      await h.props.WorkspacesView.onOpenSkill("s9", "SKILL.md");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/skills/s9?file=SKILL.md"));
    ask.mockRestore();
  });

  it("opens on Home, sends a page the web does not have there, and shows the tasks on theirs", async () => {
    api();
    render(<App />);
    // Home is the dashboard, headed like any page; the agents' menu is the Agents page's.
    await waitFor(() => expect(h.props.HomeView).toBeTruthy());
    expect(h.props.Sidebar.active).toBe("home");
    expect(screen.getByRole("heading").textContent).toBe("Home");
    expect(h.props.AgentsNav).toBeUndefined();
    // The tasks the Tasks page reads; each section's View all, and a row of each.
    await waitFor(() => expect(h.props.HomeView.tasks).toEqual(tasks.rows));
    for (const [page, hash] of [["workspaces", "#/workspaces"], ["agents", "#/agents"], ["tasks", "#/tasks"], ["devices", "#/devices"]]) {
      await act(async () => {
        await h.props.HomeView.onView(page);
      });
      await waitFor(() => expect(window.location.hash).toBe(hash));
      expect(h.props.Sidebar.active).toBe(page);
      await go("#/home");
    }
    // A section's +: a workspace's start form, a new task.
    await act(async () => {
      await h.props.HomeView.onNew("workspaces");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces?new=1"));
    expect(h.props.WorkspacesView.workspace).toBeNull();
    expect(h.props.WorkspacesView.start).toBe(true);
    // All workspaces, from the menu: no form.
    await act(async () => {
      await h.props.WorkspacesNav.onSelect(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/workspaces"));
    expect(h.props.WorkspacesView.start).toBe(false);
    expect(h.props.WorkspacesNav.selectedWorkspace).toBeNull();
    await go("#/home");
    await act(async () => {
      await h.props.HomeView.onNew("tasks");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    await waitFor(() => expect(h.props.TasksView.creating).toBe(true));
    await act(async () => {
      await h.props.Sidebar.onSelect("home");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    for (const [open, id, hash] of [["onOpenWorkspace", "p1", "#/workspaces/p1"], ["onOpenAgent", "a1", "#/agents/a1"], ["onOpenTask", "t1", "#/tasks/t1"]]) {
      await act(async () => {
        await h.props.HomeView[open](id);
      });
      await waitFor(() => expect(window.location.hash).toBe(hash));
      await go("#/home");
    }
    // The desktop's pages that are not on the web land on Home.
    for (const hash of ["#/inspector", "#/dashboard"]) {
      await go(hash);
      expect(h.props.Sidebar.active).toBe("home");
    }
    // A browser notification clicked: Activity.
    act(() => h.openActivity!());
    await waitFor(() => expect(window.location.hash).toBe("#/activity"));
    await go("#/activity");
    expect(h.props.Sidebar.active).toBe("activity");
    // Its menu: all of it, or one agent's; it hears what the page read.
    expect(h.props.ActivityNav).toMatchObject({ items: null, selected: null });
    expect(h.props.ActivityView.agent).toBeNull();
    act(() => h.props.ActivityView.onItems([{ id: "n1", agent: "scout" }]));
    expect(h.props.ActivityNav.items).toEqual([{ id: "n1", agent: "scout" }]);
    act(() => h.props.ActivityNav.onSelect("scout"));
    await waitFor(() => expect(window.location.hash).toBe("#/activity/scout"));
    expect(h.props.ActivityView.agent).toBe("scout");
    expect(h.props.ActivityNav.selected).toBe("scout");
    act(() => h.props.ActivityNav.onSelect(null));
    await waitFor(() => expect(window.location.hash).toBe("#/activity"));
    expect(screen.getByRole("heading").textContent).toBe("Activity");
    expect(h.props.ActivityView).toBeTruthy();
    // The Tools page (again since 2026-11-15), from the rail and by its address.
    await act(async () => {
      await h.props.Sidebar.onSelect("tools");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tools"));
    await go("#/tools");
    expect(h.props.Sidebar.active).toBe("tools");
    expect(screen.getByRole("heading").textContent).toBe("Tools");
    expect(h.props.ToolsView).toBeTruthy();
    // Its menu: all of them, or one kind; it hears what the page read. A kind it has not is all.
    expect(h.props.ToolsNav).toMatchObject({ library: null, selected: null });
    act(() => h.props.ToolsView.onLibrary([{ id: "t1" }]));
    expect(h.props.ToolsNav.library).toEqual([{ id: "t1" }]);
    act(() => h.props.ToolsNav.onSelect("website"));
    await waitFor(() => expect(window.location.hash).toBe("#/tools/website"));
    expect(h.props.ToolsView.tab).toBe("website");
    expect(h.props.ToolsNav.selected).toBe("website");
    act(() => h.props.ToolsNav.onSelect(null));
    await waitFor(() => expect(window.location.hash).toBe("#/tools"));
    await go("#/tools/nope");
    expect(h.props.ToolsView.tab).toBeNull();
    await act(async () => {
      await h.props.Sidebar.onSelect("home");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    await act(async () => {
      await h.props.Sidebar.onSelect("activity");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/activity"));
    await go("#/devices");
    expect(h.props.Sidebar.active).toBe("devices");
    expect(screen.getByRole("heading").textContent).toBe("Devices");
    expect(h.props.DevicesView).toBeTruthy();
    // Its menu, nothing picked: the list. A device from the menu or the list opens its page.
    expect(h.props.DevicesNav.selected).toBeNull();
    await act(async () => {
      h.props.DevicesView.onOpenDevice("l 1");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/devices/l%201"));
    expect(h.props.DevicesNav.selected).toBe("l 1");
    expect(h.props.DeviceDetail.device).toBe("l 1");
    // Its page has its own heading.
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => {
      h.props.DeviceDetail.onOpenAgent("scout");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/scout"));
    await go("#/devices/cloud");
    expect(h.props.DeviceDetail.device).toBe("cloud");
    // Unpaired: back to the list, as All devices in the menu does.
    await act(async () => {
      h.props.DeviceDetail.onUnpaired();
    });
    await waitFor(() => expect(window.location.hash).toBe("#/devices"));
    await go("#/devices/cloud");
    await act(async () => {
      h.props.DevicesNav.onSelect(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/devices"));
    // A browser just paired on Devices: its agent's settings open.
    await act(async () => {
      await h.props.DevicesView.onOpenAgent("sky");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/sky"));
    expect(h.props.Sidebar.active).toBe("agents");
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    await act(async () => {
      await h.props.Sidebar.onSelect("devices");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/devices"));
    // Connections is Devices on the rail now, as on the desktop: its old addresses open it.
    for (const hash of ["#/settings/connections", "#/settings/machines"]) {
      await go(hash);
      expect(h.props.Sidebar.active).toBe("devices");
      expect(screen.getByRole("heading").textContent).toBe("Devices");
    }
    // Settings opens on System; any of the desktop's other panes (and the AI Providers
    // there was) lands there too.
    for (const [hash, tab] of [["#/settings", undefined], ["#/settings/system", "system"], ["#/settings/browsers", "system"], ["#/settings/ai-providers", "system"]]) {
      await go(hash as string);
      expect(h.props.Sidebar.active).toBe("settings");
      expect(screen.getByRole("heading").textContent).toBe("Settings");
      expect(h.props.SettingsView.tab).toBe(tab);
    }
    // The person's Account: #/profile (its old address) opens it on Profile.
    for (const [hash, tab] of [["#/profile", undefined], ["#/account", undefined], ["#/account/billing", "billing"], ["#/account/nope", "profile"]]) {
      await go(hash as string);
      expect(h.props.Sidebar.active).toBe("profile");
      expect(screen.getByRole("heading").textContent).toBe("Account");
      expect(h.props.AccountView.tab).toBe(tab);
    }
    await act(async () => {
      await h.props.AccountView.onSelectTab("billing");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/account/billing"));
    await act(async () => {
      await h.props.Sidebar.onSelect("profile");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/account"));
    // A pane chosen is in the hash.
    await act(async () => {
      await h.props.SettingsView.onSelectTab("system");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/settings/system"));
    await act(async () => {
      await h.props.Sidebar.onSelect("home");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/home"));
    await act(async () => {
      await h.props.Sidebar.onSelect("settings");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/settings"));
    await go("#/tasks");
    expect(screen.getByRole("heading").textContent).toBe("Tasks");
    await waitFor(() => expect(h.props.TasksView.rows).toEqual(tasks.rows));
    expect(h.props.TasksView.currentUserEmail).toBe("me@x");
  });

  it("routes the Agents page's agents and their tabs by the hash, Home's and the chat's old addresses included", async () => {
    api();
    window.location.hash = "#/agents/aide/instructions";
    render(<App />);
    await waitFor(() => expect(h.props.AgentsPage?.agent).toBe("aide"));
    expect(h.props.AgentsPage.meRole).toBe("AGENT_ADMIN");
    expect(h.props.Sidebar.active).toBe("agents");
    expect(h.props.AgentsPage.tab).toBe("instructions");
    expect(h.props.AgentsNav.selected).toBe("aide");
    // Its settings carry their own heading.
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => {
      await h.props.AgentsPage.onOpen("aide", "tools");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/aide/tools"));
    await act(async () => {
      await h.props.AgentsNav.onSelect("wysebee");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/wysebee"));
    await act(async () => {
      await h.props.AgentsNav.onSelect("a b");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/a%20b"));
    expect(h.props.AgentsPage.agent).toBe("a b");
    expect(h.props.AgentsPage.tab).toBeNull();
    // From the rail, or All agents in the menu: the list of them, headed like any page.
    await act(async () => {
      await h.props.Sidebar.onSelect("agents");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents"));
    expect(h.props.AgentsNav.selected).toBeNull();
    expect(screen.getByRole("heading").textContent).toBe("Agents");
    await act(async () => {
      await h.props.AgentsList.onOpen("aide");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/aide"));
    await act(async () => {
      await h.props.AgentsNav.onSelect(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents"));
    // Home's old addresses for an agent open it here.
    await go("#/home/agent/aide/tools");
    await waitFor(() => expect(h.props.AgentsPage.agent).toBe("aide"));
    expect(h.props.AgentsPage.tab).toBe("tools");
    expect(h.props.Sidebar.active).toBe("agents");
    // A Wysebee tab with no agent named in the route.
    await go("#/home?settings=tools");
    await waitFor(() => expect(h.props.AgentsPage.agent).toBe("wysebee"));
    expect(h.props.AgentsPage.tab).toBe("tools");
    await act(async () => {
      await h.props.AgentsPage.onOpen("wysebee", "property");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/wysebee/property"));
    // The chat's old addresses: a direct message opens its agent; a topic is just Home.
    await go("#/home/dm/sky");
    await waitFor(() => expect(h.props.AgentsPage.agent).toBe("sky"));
    await go("#/home/dm/aide?settings=tools&agent=aide");
    await waitFor(() => expect(h.props.AgentsPage.tab).toBe("tools"));
    await go("#/home?settings=nope&agent=aide");
    await waitFor(() => expect(h.props.AgentsPage.agent).toBe("aide"));
    expect(h.props.AgentsPage.tab).toBeNull();
    await go("#/home/topic/t1");
    expect(h.props.Sidebar.active).toBe("home");
  });

  it("asks before leaving an agent's unsaved settings", async () => {
    api();
    window.location.hash = "#/agents/aide/tools";
    render(<App />);
    await waitFor(() => expect(h.props.AgentsPage?.agent).toBe("aide"));
    h.unsaved = true;
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    // Another tab of the same agent keeps the edits: nothing to ask.
    await act(async () => {
      await h.props.AgentsPage.onOpen("aide", "skills");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/agents/aide/skills"));
    expect(confirm).not.toHaveBeenCalled();
    // Another agent, or another page: asked, and staying.
    await act(async () => {
      await h.props.AgentsNav.onSelect("wysebee");
    });
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    // All agents too, from the menu or the rail.
    await act(async () => {
      await h.props.AgentsNav.onSelect(null);
    });
    await act(async () => {
      await h.props.Sidebar.onSelect("agents");
    });
    expect(confirm).toHaveBeenCalledTimes(4);
    expect(window.location.hash).toBe("#/agents/aide/skills");
    confirm.mockResolvedValue(true);
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    h.unsaved = false;
    confirm.mockRestore();
  });

  it("routes tasks by the hash, a refresh reopening them", async () => {
    api();
    await renderApp("#/tasks/my%20task");
    expect(h.props.TasksView).toMatchObject({ selected: "my task", tab: null });

    await go("#/tasks/t1/plan");
    expect(h.props.TasksView).toMatchObject({ selected: "t1", tab: "plan" });
    await go("#/tasks/t1/run");
    expect(h.props.TasksView).toMatchObject({ selected: "t1", tab: "run" });
    await go("#/tasks");
    expect(h.props.TasksView.selected).toBeNull();
  });

  it("has a Tasks menu: All tasks, each task, and a new one", async () => {
    api();
    await renderApp("#/tasks/t1");
    await waitFor(() => expect(h.props.TasksNav.rows).toEqual(tasks.rows));
    expect(h.props.TasksNav.selected).toBe("t1");
    await act(async () => {
      h.props.TasksNav.onSelect(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    expect(h.props.TasksNav.selected).toBeNull();
    await act(async () => {
      h.props.TasksNav.onSelect("t1");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/t1"));
    await act(async () => {
      h.props.TasksNav.onCreate();
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    expect(h.props.TasksView.creating).toBe(true);
  });

  it("offers no new task in the menu to someone who may not make one", async () => {
    api({ "GET /api/v1/config/users/me": { ...admin, user_role: "AGENT_READER" } });
    window.location.hash = "#/tasks";
    render(<App />);
    await waitFor(() => expect(h.props.TasksView?.meRole).toBe("AGENT_READER"));
    expect(h.props.TasksNav.onCreate).toBeUndefined();
  });

  it("navigates from the rail and the views", async () => {
    api();
    await renderApp();
    await act(async () => {
      await h.props.TasksView.onSelect("t1", "property");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/t1/property"));
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    await act(async () => {
      await h.props.TasksView.onSelect("t1", "property");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/t1/property"));
    await act(async () => {
      await h.props.TasksView.onTabChange("plan");
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks/t1/plan"));
    await act(async () => {
      await h.props.TasksView.onSelect(null);
    });
    await waitFor(() => expect(window.location.hash).toBe("#/tasks"));
    // A tab change with no task open goes nowhere.
    await act(async () => {
      await h.props.TasksView.onTabChange("plan");
    });
    expect(window.location.hash).toBe("#/tasks");
    // Selecting the page already open keeps it.
    await act(async () => {
      await h.props.Sidebar.onSelect("tasks");
    });
    expect(window.location.hash).toBe("#/tasks");
  });

  it("starts a create from the list, and leaves it when moving on", async () => {
    api();
    await renderApp("#/tasks/t1");
    await act(async () => {
      await h.props.TasksView.onCreate();
    });
    await waitFor(() => expect(h.props.TasksView.creating).toBe(true));
    expect(window.location.hash).toBe("#/tasks");
    await act(async () => {
      await h.props.TasksView.onSelect("t1");
    });
    await waitFor(() => expect(h.props.TasksView.creating).toBe(false));
  });

  it("re-reads a list after a change", async () => {
    const f = api();
    await renderApp();
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(1));
    await act(async () => {
      await h.props.TasksView.onChanged();
    });
    expect(f.to("GET /api/v1/tasks")).toHaveLength(2);
  });

  it("shows why the role or a list could not be read", async () => {
    api({ "GET /api/v1/config/users/me": reply(500, { detail: "who?" }), "GET /api/v1/tasks": reply(500, { detail: "down" }) });
    render(<App />);
    expect(await screen.findByText(/down|who\?/)).toBeTruthy();
  });

  it("shows a failure that is not an Error as text", async () => {
    api({ "GET /api/v1/config/users/me": () => Promise.reject("bare"), "GET /api/v1/tasks": () => Promise.reject("odd") });
    render(<App />);
    expect(await screen.findByText(/bare|odd/)).toBeTruthy();
  });

  it("re-reads the lists when something changes elsewhere, keeping the open editor", async () => {
    const f = api();
    await renderApp("#/tasks/t1");
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(1));
    const mounted = h.mounts.TasksView;

    // Not from the change feed: just the lists.
    changed();
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(2));
    expect(h.mounts.TasksView).toBe(mounted);

    // Another device changed something else: the lists, the editor left alone.
    changed({ remote: true, changes: [{ kind: "task", item_id: "t2", name: "x", deleted: false }] });
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(3));
    expect(h.mounts.TasksView).toBe(mounted);
    // ...an item of another kind that happens to share the id: not the open task.
    changed({ remote: true, changes: [{ kind: "agent", item_id: "t1", name: "x", deleted: false }] });
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(4));
    expect(h.mounts.TasksView).toBe(mounted);

    // ...the open task, with nothing unsaved: the editor re-reads it.
    changed({ remote: true, changes: [{ kind: "task", item_id: "t1", name: "x", deleted: false }] });
    await waitFor(() => expect(h.mounts.TasksView).toBe(mounted + 1));
    expect(h.toast).not.toHaveBeenCalled();

    // ...this page's own save, echoed back while its bar still shows: the lists only — not
    // "changed on another device", and the editor is not reloaded under it.
    h.unsaved = true;
    const before = f.to("GET /api/v1/tasks").length;
    changed({ remote: true, changes: [], own: true });
    await waitFor(() => expect(f.to("GET /api/v1/tasks")).toHaveLength(before + 1));
    expect(h.toast).not.toHaveBeenCalled();
    expect(h.mounts.TasksView).toBe(mounted + 1);

    // ...with unsaved edits: told, and offered a reload.
    changed({ remote: true, changes: [] });
    await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(1));
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    h.toast.mock.calls[0][1].action.onClick();
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("leaves the list page alone when something changes elsewhere", async () => {
    api();
    await renderApp("#/tasks");
    const mounted = h.mounts.TasksView;
    changed({ remote: true, changes: [] });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.mounts.TasksView).toBe(mounted);
  });

  it("takes a person with no email", async () => {
    api({ "GET /api/v1/config/users/me": { ...admin, email: null } });
    await renderApp();
    expect(h.props.TasksView.currentUserEmail).toBe("");
  });

  it("forgets a role answer that comes after it is gone", async () => {
    let answer!: (v: unknown) => void;
    api({ "GET /api/v1/config/users/me": () => new Promise((r) => (answer = r)) });
    const { unmount } = render(<App />);
    await waitFor(() => expect(answer).toBeTypeOf("function"));
    unmount();
    answer(admin);
    let fail!: (e: unknown) => void;
    api({ "GET /api/v1/config/users/me": () => new Promise((_r, j) => (fail = j)) });
    const second = render(<App />);
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    second.unmount();
    fail(new Error("late"));
    await new Promise((r) => setTimeout(r, 10));
  });
});
