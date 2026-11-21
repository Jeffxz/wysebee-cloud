import { useCallback, useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import {
  canCreateConfig,
  UserRole,
  fetchMe,
  fetchTasks,
  type Task,
  type ActivityNotification,
  type Tool,
  APP_CHANGED,
  type RemoteChangeDetail,
} from "./api";
import { hasUnsavedEdits } from "./components/common/autoSave";
import { useTranslation } from "react-i18next";
import { cn, errorBanner } from "@shared/cn";
import { Sidebar, type Section } from "./components/SideNav/Sidebar";
import { TasksView } from "./components/TasksView";
import { TasksNav } from "./components/TasksNav";
import { ActivityView } from "./components/ActivityView";
import { ActivityNav } from "./components/ActivityNav";
import { startBrowserNotify } from "./browserNotify";
import { AgentsPage, settingsTabFromSegment as agentTabFromSegment, type SettingsTab as AgentTab } from "./components/AgentsPage";
import { AgentsNav } from "./components/AgentsNav";
import { AgentsList } from "./components/AgentsList";
import { DevicesNav } from "./components/DevicesNav";
import { DeviceDetail } from "./components/DeviceDetail";
import { HomeView } from "./components/HomeView";
import { WorkspacesNav } from "./components/WorkspacesNav";
import { hasUnsavedWorkspaceEdits, WorkspacesView } from "./components/WorkspacesView";
import { useWorkspaces } from "./workspaces";
import { SkillsNav } from "./components/SkillsNav";
import { hasUnsavedSkillEdits, SkillsView } from "./components/SkillsView";
import { useSkills } from "./skills";
import { ToolsView } from "./components/ToolsView";
import { ToolsNav } from "./components/ToolsNav";
import { LIBRARY_TABS, type LibraryTab } from "./components/AgentsView/ToolCards";
import { PageView } from "./components/PageView";
import { WYSEBEE } from "./agents";
import { taskTabFromSegment, type TaskTab } from "./components/TasksView/tabs";
import { SettingsView } from "./components/SettingsView";
import { DevicesView } from "./components/SettingsView/DevicesView";
import { settingsTabFromSegment, type SettingsTab } from "./components/SettingsView/tabs";
import { AccountView, accountTabFromSegment, type AccountTab } from "./components/ProfileView";
import { loadTheme, useTheme } from "./theme";
import { registerSensitiveNames } from "./telemetry";
import { dialogs } from "./components/common/confirm";

// Tasks are keyed by id in the URL: a task can be renamed, and a bookmark should
// still open it.
type TaskView =
  | { kind: "list" }
  | { kind: "detail"; id: string; tab?: TaskTab | null };

// The URL hash is the single source of truth for the active section and the
// sub-view within it, so a browser refresh restores exactly what was on screen.
// `#/home`: a dashboard of the person's agents and devices (2026-11-19). `#/agents`: all of the
// person's agents (2026-11-20; Wysebee's settings until then); `#/agents/<id>[/<tab>]` an agent's — Home's until 2026-11-19, so Home's agent
// addresses (`#/home/agent/<id>[/<tab>]`) and the chat's older ones (`#/home/dm/<agent>`,
// `#/home?settings=<tab>[&agent=<name>]`) open the agent they named on the Agents page.
// `#/devices`: Wysebee Cloud and the person's devices (Settings → Connections until
// 2026-11-04; `#/settings/connections` and `/machines` open it); `#/devices/<id>` one
// device's page (2026-11-20; `cloud` for Wysebee Cloud), opened from the Devices menu. `#/settings[/<pane>]`:
// System. `#/account[/profile|billing]`: their Account — name, picture
// and sign-in, then Billing (`#/profile`, its address until 2026-11-04, opens Profile).
type Route =
  | { section: "tasks"; taskView: TaskView }
  | { section: "home" }
  | { section: "agents"; agent?: string; tab?: AgentTab }
  | { section: "devices"; device?: string }
  // The AI app's notifications (2026-11-14).
  // `#/activity/<handle>`: only that agent's (2026-11-20).
  | { section: "activity"; agent?: string }
  // The person's workspaces: one opened, and a file of it in the editor.
  // A rich HTML page the AI app made from a document (2026-11-17): `#/pages/<id>`, in Workspaces.
  // `#/workspaces?new=1`: all of them, with the form that starts one open (Home's +).
  | { section: "workspaces"; workspace?: string; file?: string; page?: string; start?: boolean }
  // The person's skills: one opened, and a file of it in the editor (2026-11-17).
  | { section: "skills"; skill?: string; file?: string }
  // The person's tools and the kinds they can make, each given to an agent with its + (2026-11-15).
  // `#/tools/<tab>`: one kind of tool (2026-11-20, its row in the Tools menu).
  | { section: "tools"; tab?: LibraryTab }
  | { section: "settings"; tab?: SettingsTab }
  | { section: "profile"; tab?: AccountTab };

function parseRoute(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#/, "").replace(/^\/+/, "").split("?");
  const [seg, sub, extra] = path.split("/");
  const params = new URLSearchParams(query);
  switch (seg) {
    case "home": {
      // Home's old addresses for an agent's settings: the Agents page.
      const named = (sub === "agent" || sub === "dm") && extra ? decodeURIComponent(extra) : params.get("agent");
      const tab = agentTabFromSegment(sub === "agent" ? path.split("/")[3] : (params.get("settings") ?? undefined));
      if (!named && !tab) return { section: "home" };
      // A settings tab with no agent named was Wysebee's.
      return { section: "agents", agent: named || WYSEBEE, ...(tab ? { tab } : {}) };
    }
    case "agents": {
      const tab = sub ? agentTabFromSegment(extra) : null;
      return { section: "agents", ...(sub ? { agent: decodeURIComponent(sub) } : {}), ...(tab ? { tab } : {}) };
    }
    case "tasks":
      return sub
        ? {
            section: "tasks",
            taskView: { kind: "detail", id: decodeURIComponent(sub), tab: taskTabFromSegment(extra) },
          }
        : { section: "tasks", taskView: { kind: "list" } };
    case "activity":
      return sub ? { section: "activity", agent: decodeURIComponent(sub) } : { section: "activity" };
    // `#/skills` is the Skills page again since 2026-11-17: the person's library of skills.
    // `#/tools` (a rail page 2026-10-29 to 2026-11-12, then Home) is the Tools page again since
    // 2026-11-15: the person's tools, each given to agents from there.
    case "skills": {
      const file = params.get("file");
      return { section: "skills", ...(sub ? { skill: decodeURIComponent(sub) } : {}), ...(sub && file ? { file } : {}) };
    }
    case "devices":
      return sub ? { section: "devices", device: decodeURIComponent(sub) } : { section: "devices" };
    case "tools":
      return (LIBRARY_TABS as readonly (string | undefined)[]).includes(sub) ? { section: "tools", tab: sub as LibraryTab } : { section: "tools" };
    case "pages":
      return sub ? { section: "workspaces", page: decodeURIComponent(sub) } : defaultRoute("workspaces");
    case "workspaces": {
      const file = params.get("file");
      if (!sub) return params.get("new") ? { section: "workspaces", start: true } : { section: "workspaces" };
      return { section: "workspaces", workspace: decodeURIComponent(sub), ...(file ? { file } : {}) };
    }
    case "settings":
      // Connections moved to the rail, as Devices: its old addresses open it.
      if (sub === "connections" || sub === "machines") return { section: "devices" };
      // A bare #/settings is the first pane; any other the desktop has lands there too.
      return sub ? { section: "settings", tab: settingsTabFromSegment(sub) } : { section: "settings" };
    case "profile":
      return { section: "profile" };
    case "account":
      return sub ? { section: "profile", tab: accountTabFromSegment(sub) } : { section: "profile" };
    default:
      // No hash, or a link to a page the web does not have (the desktop's): Home.
      return defaultRoute("home");
  }
}

function routeToHash(route: Route): string {
  if (route.section === "home") return "/home";
  if (route.section === "agents") {
    if (!route.agent) return "/agents";
    return `/agents/${encodeURIComponent(route.agent)}` + (route.tab ? `/${route.tab}` : "");
  }
  if (route.section === "settings") return route.tab ? `/settings/${route.tab}` : "/settings";
  if (route.section === "profile") return route.tab ? `/account/${route.tab}` : "/account";
  if (route.section === "devices") return route.device ? `/devices/${encodeURIComponent(route.device)}` : "/devices";
  if (route.section === "activity") return route.agent ? `/activity/${encodeURIComponent(route.agent)}` : "/activity";
  if (route.section === "tools") return route.tab ? `/tools/${route.tab}` : "/tools";
  if (route.section === "workspaces")
    return route.workspace
      ? `/workspaces/${encodeURIComponent(route.workspace)}` + (route.file ? `?file=${encodeURIComponent(route.file)}` : "")
      : route.start
        ? "/workspaces?new=1"
        : "/workspaces";
  if (route.section === "skills")
    return route.skill
      ? `/skills/${encodeURIComponent(route.skill)}` + (route.file ? `?file=${encodeURIComponent(route.file)}` : "")
      : "/skills";
  return route.taskView.kind === "detail"
    ? `/tasks/${encodeURIComponent(route.taskView.id)}` + (route.taskView.tab ? `/${route.taskView.tab}` : "")
    : "/tasks";
}

function defaultRoute(section: Section): Route {
  return section === "tasks" ? { section, taskView: { kind: "list" } } : { section };
}

export default function App() {
  const { t } = useTranslation();
  // Bumped when the open item changed on another device and its editor has nothing
  // unsaved: remounting the content makes the editor read the new version.
  const [contentKey, setContentKey] = useState(0);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const { items: workspaceItems } = useWorkspaces();
  const { items: skillItems } = useSkills();
  // Tasks: the list (the list page reads it) and the new-task flag.
  const [tasksList, setTasksList] = useState<Task[] | null>(null);
  const [creatingTask, setCreatingTask] = useState(false);
  // The person's tools the Tools page read, for its menu.
  const [toolsLibrary, setToolsLibrary] = useState<Tool[] | null>(null);
  // The notifications Activity read, for its menu.
  const [activityItems, setActivityItems] = useState<ActivityNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meRole, setMeRole] = useState<UserRole | null>(null);
  const [meEmail, setMeEmail] = useState<string>("");

  // The caller's role and email, to gate the editors: AGENT_ADMIN/AGENT_EDITOR can edit
  // and save; an unresolved role is view-only. A signed-in person is AGENT_ADMIN of
  // their own agents and tasks (cloud/router.ts).
  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setMeRole(me.user_role);
        setMeEmail(me.email ?? "");
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const section = route.section;
  const theme = useTheme();

  // The look saved with Wysebee's settings (theme.ts), read again when it changes elsewhere.
  useEffect(() => {
    void loadTheme();
    const onChange = (e: Event) => {
      if ((e as CustomEvent<RemoteChangeDetail | undefined>).detail?.remote) void loadTheme();
    };
    window.addEventListener(APP_CHANGED, onChange);
    return () => window.removeEventListener(APP_CHANGED, onChange);
  }, []);

  const taskView: TaskView = route.section === "tasks" ? route.taskView : { kind: "list" };

  // Drive navigation through the URL hash so the back/forward buttons and a
  // refresh all stay in sync. Setting the hash fires `hashchange`, which is the
  // single place that updates `route` — avoiding a state/URL feedback loop.
  const navigate = useCallback((next: Route) => {
    const target = routeToHash(next);
    if (window.location.hash.replace(/^#/, "") !== target) {
      window.location.hash = target;
    } else {
      setRoute(next);
    }
  }, []);

  // A notification from the person's AI app, as a browser notification while this tab is not
  // in front (browserNotify.ts); clicking it opens Activity.
  useEffect(() => startBrowserNotify(() => navigate({ section: "activity" })), [navigate]);

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const runLoad = useCallback(
    async <T,>(fn: () => Promise<T>, apply: (value: T) => void) => {
      setError(null);
      try {
        apply(await fn());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const loadTasks = useCallback(() => runLoad(fetchTasks, (res) => setTasksList(res.rows)), [runLoad]);
  // Tasks' names never leave in an analytics label (telemetry.ts).
  useEffect(() => registerSensitiveNames((tasksList ?? []).map((x) => x.name)), [tasksList]);

  useEffect(() => {
    if (tasksList === null) loadTasks();
  }, [tasksList, loadTasks]);

  // Something changed outside the page that shows it — an item changed on another device
  // (cloud/events.ts): read the lists again. An editor already open keeps what it loaded
  // — re-reading under someone mid-edit would throw their unsaved changes away; when the
  // change elsewhere is to the very item they are editing, they are told and offered a
  // reload instead.
  useEffect(() => {
    const reload = (event: Event) => {
      const remote = (event as CustomEvent<RemoteChangeDetail | undefined>).detail;
      // This page's own save echoed back by the feed is not a change "on another device".
      if (remote?.remote && !remote.own) {
        const openId = taskView.kind === "detail" ? taskView.id : null;
        const touched =
          openId !== null &&
          (remote.changes.length === 0 || remote.changes.some((c) => c.kind === "task" && c.item_id === openId));
        if (touched && hasUnsavedEdits()) {
          toast(t("cloud.changedElsewhere.message"), {
            // Bottom: the unsaved-changes bar this goes with is pinned at the top, and
            // a toast there would sit over its Save button.
            position: "bottom-right",
            duration: 15000,
            action: {
              label: t("cloud.changedElsewhere.reload"),
              onClick: () => window.location.reload(),
            },
          });
        } else if (touched) {
          setContentKey((k) => k + 1);
        }
      }
      loadTasks();
    };
    window.addEventListener(APP_CHANGED, reload);
    return () => window.removeEventListener(APP_CHANGED, reload);
  }, [loadTasks, taskView, t]);

  // Leaving a workspace file with edits not saved asks first.
  const leaveWorkspaceFile = async () => !hasUnsavedWorkspaceEdits() || (await dialogs.confirm(t("workspaces.editor.leaveConfirm"), { action: "leave" }));
  const openWorkspace = async (workspace: string | null, file?: string) => {
    if (!(await leaveWorkspaceFile())) return;
    navigate(workspace ? { section: "workspaces", workspace, ...(file ? { file } : {}) } : defaultRoute("workspaces"));
  };

  // Leaving a skill's file with edits not saved asks first.
  const leaveSkillFile = async () => !hasUnsavedSkillEdits() || (await dialogs.confirm(t("workspaces.editor.leaveConfirm"), { action: "leave" }));
  const openSkill = async (skill: string | null, file?: string) => {
    if (!(await leaveSkillFile())) return;
    navigate(skill ? { section: "skills", skill, ...(file ? { file } : {}) } : defaultRoute("skills"));
  };
  // The AI app made a skill while a workspace page was open: go to it (its page took the editor).
  const openSkillFromWorkspace = async (skill: string, file: string) => {
    if (!(await leaveWorkspaceFile())) return;
    navigate({ section: "skills", skill, file });
  };

  // Leaving an agent's settings with edits not saved asks first.
  const leaveAgent = async () => !hasUnsavedEdits() || (await dialogs.confirm(t("home.settings.discard"), { action: "discard" }));
  // An agent's settings, or (null) the list of all of them.
  const openAgent = async (agent: string | null, tab?: AgentTab) => {
    const same = route.section === "agents" && route.agent === agent;
    if (route.section === "agents" && route.agent && !same && !(await leaveAgent())) return;
    navigate(agent ? { section: "agents", agent, ...(tab ? { tab } : {}) } : { section: "agents" });
  };

  const openDevice = (device: string | null) => navigate(device ? { section: "devices", device } : { section: "devices" });

  const onSelectSection = async (s: Section) => {
    if (section === "workspaces" && !(await leaveWorkspaceFile())) return;
    if (section === "skills" && !(await leaveSkillFile())) return;
    if (route.section === "agents" && route.agent && !(await leaveAgent())) return;
    setError(null);
    setCreatingTask(false);
    navigate(defaultRoute(s));
  };

  const startTask = () => {
    setError(null);
    setCreatingTask(true);
    navigate(defaultRoute("tasks"));
  };

  const openTask = (id: string | null, tab?: TaskTab) => {
    setCreatingTask(false);
    navigate(id ? { section: "tasks", taskView: { kind: "detail", id, tab } } : defaultRoute("tasks"));
  };

  // A page open in Workspaces is headed by its workspace's name rather than "Workspaces".
  const openPageWorkspace =
    route.section === "workspaces" && route.file
      ? workspaceItems?.find((p) => p.id === route.workspace)?.name
      : route.section === "skills" && route.file
        ? skillItems?.find((s) => s.id === route.skill)?.name
        : undefined;

  // A page the AI app made, at its own address: the page alone, with none of Wysebee around it.
  if (route.section === "workspaces" && route.page)
    return (
      <>
        <Toaster theme={theme} richColors position="top-right" closeButton />
        <PageView pageId={route.page} />
      </>
    );

  return (
    <div className="flex min-h-screen items-stretch">
      <Toaster theme={theme} richColors position="top-right" closeButton />
      <Sidebar active={section} onSelect={onSelectSection} />
      {/* The Agents page's own menu: the agents. */}
      {/* The Workspaces menu: every workspace, and each one's folder structure. */}
      {route.section === "workspaces" && (
        <WorkspacesNav selectedWorkspace={route.workspace ?? null} selectedFile={route.file ?? null} onSelect={openWorkspace} />
      )}
      {/* The Skills menu: every skill, and each one's files and folders. */}
      {route.section === "skills" && <SkillsNav selectedSkill={route.skill ?? null} selectedFile={route.file ?? null} onSelect={openSkill} />}
      {/* The Activity menu: all of it, then each agent that sent some. */}
      {route.section === "activity" && (
        <ActivityNav items={activityItems} selected={route.agent ?? null} onSelect={(agent) => navigate(agent ? { section: "activity", agent } : { section: "activity" })} />
      )}
      {/* The Tools menu: all of them, then each kind. */}
      {route.section === "tools" && (
        <ToolsNav library={toolsLibrary} selected={route.tab ?? null} onSelect={(tab) => navigate(tab ? { section: "tools", tab } : { section: "tools" })} />
      )}
      {/* The Tasks menu: All tasks, then each task. */}
      {route.section === "tasks" && (
        <TasksNav
          rows={tasksList}
          selected={taskView.kind === "detail" ? taskView.id : null}
          onSelect={(id) => openTask(id)}
          onCreate={canCreateConfig(meRole) ? startTask : undefined}
        />
      )}
      {route.section === "agents" && <AgentsNav selected={route.agent ?? null} onSelect={(agent) => openAgent(agent)} />}
      {/* The Devices menu: Wysebee Cloud, each device and each browser. */}
      {route.section === "devices" && <DevicesNav selected={route.device ?? null} onSelect={openDevice} />}
      <div
        key={contentKey}
        className={cn(
          "mx-auto w-full min-w-0 flex-1",
          route.section === "agents" && route.agent ? "flex h-screen max-w-none flex-col overflow-hidden bg-white p-4 dark:bg-stone-900" : "max-w-[1100px] px-4 py-6",
          // Settings fills the window and scrolls its own lists (the AI providers), as on the desktop.
          route.section === "settings" && "flex h-screen flex-col overflow-hidden",
        )}
      >
        {!(route.section === "agents" && route.agent) && !(route.section === "devices" && route.device) && (
          <div className="mb-4 flex shrink-0 items-center gap-2 border-b border-stone-200 pb-3 dark:border-stone-700">
            <h1 className="truncate text-lg font-semibold">{openPageWorkspace ?? t(route.section === "profile" ? "profile.page" : `shell.headers.${route.section}`)}</h1>
          </div>
        )}

        {route.section === "workspaces" && (
          <WorkspacesView workspace={route.workspace ?? null} file={route.file ?? null} start={!!route.start} onOpen={openWorkspace} onOpenSkill={openSkillFromWorkspace} currentUserEmail={meEmail} />
        )}
        {route.section === "skills" && <SkillsView skill={route.skill ?? null} file={route.file ?? null} onOpen={openSkill} currentUserEmail={meEmail} />}
        {route.section === "activity" && <ActivityView agent={route.agent ?? null} onItems={setActivityItems} />}
        {route.section === "tools" && <ToolsView tab={route.tab ?? null} onLibrary={setToolsLibrary} />}
        {route.section === "devices" &&
          (route.device ? (
            <DeviceDetail device={route.device} onOpenAgent={(name) => navigate({ section: "agents", agent: name })} onUnpaired={() => openDevice(null)} />
          ) : (
            <DevicesView onOpenAgent={(name) => navigate({ section: "agents", agent: name })} onOpenDevice={openDevice} />
          ))}
        {route.section === "home" && (
          <HomeView
            tasks={tasksList}
            onOpenWorkspace={(workspace) => openWorkspace(workspace)}
            onOpenAgent={(agent) => openAgent(agent)}
            onOpenTask={(task) => openTask(task)}
            onOpenDevice={openDevice}
            onView={(page) => navigate(defaultRoute(page))}
            onNew={(page) => {
              // A task: the Tasks page's New task. A workspace: All workspaces, its start form open.
              if (page === "tasks") setCreatingTask(true);
              navigate(page === "workspaces" ? { section: "workspaces", start: true } : defaultRoute(page));
            }}
          />
        )}
        {route.section === "settings" && <SettingsView tab={route.tab} onSelectTab={(tab) => navigate({ section: "settings", tab })} />}
        {route.section === "profile" && <AccountView tab={route.tab} onSelectTab={(tab) => navigate({ section: "profile", tab })} />}

        {error && <div className={errorBanner}>{error}</div>}

        {route.section === "agents" &&
          (route.agent ? (
            <AgentsPage agent={route.agent} tab={route.tab ?? null} onOpen={openAgent} meRole={meRole} currentUserEmail={meEmail} />
          ) : (
            <AgentsList onOpen={(agent) => openAgent(agent)} />
          ))}

        {route.section === "tasks" && (
        <TasksView
          rows={tasksList}
          selected={taskView.kind === "detail" ? taskView.id : null}
          tab={taskView.kind === "detail" ? (taskView.tab ?? null) : null}
          creating={creatingTask}
          meRole={meRole}
          currentUserEmail={meEmail}
          onSelect={openTask}
          onTabChange={(tab) => {
            if (taskView.kind !== "detail") return;
            navigate({ section: "tasks", taskView: { ...taskView, tab } });
          }}
          onChanged={loadTasks}
          onCreate={startTask}
        />
        )}
      </div>
    </div>
  );
}
