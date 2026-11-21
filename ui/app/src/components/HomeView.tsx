import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Cloud, FolderKanban, Plus } from "lucide-react";
import { cn, errorBanner, muted, surface } from "@shared/cn";
import { type BrowserLink, type Task } from "../api";
import { loadAgents, useAgents } from "../agents";
import { presenceOf, useLinks } from "../presence";
import { loadWorkspaces, useWorkspaces } from "../workspaces";
import { AgentAvatar } from "./common/AgentAvatar";
import { agentDevice, DeviceIcon } from "./common/DeviceIcon";
import { AddAgentDialog } from "./AddAgentDialog";
import { ago } from "./SettingsView/DesktopsSection";
import { StatusBadge } from "./TasksView";
import { TaskKindIcon } from "./TasksView/schedule";

const row = "flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left";
const clickable = "hover:bg-stone-50 dark:hover:bg-stone-700/50";
/** The most rows a section shows; View all opens the rest. */
export const SHOWN = 5;

/** A device's status: online while it polls and is not paused. */
function Status({ state }: { state: "online" | "offline" | "paused" }) {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
      <span className={cn("h-2 w-2 rounded-full", state === "online" ? "bg-green-500" : state === "paused" ? "bg-amber-500" : "bg-stone-400")} aria-hidden />
      {t(`home.dashboard.${state}`)}
    </span>
  );
}

/** One section of the dashboard: a heading with its count, a **+** that makes one (when it
 * has one) and **View all**, then its rows. */
function Column({ title, count, viewAll, viewAllLabel, onViewAll, track, add, children }: {
  title: string;
  count: number | null;
  viewAll: string;
  viewAllLabel: string;
  onViewAll: () => void;
  track: string;
  /** The +: what it says, and what it does. */
  add?: { label: string; onClick: () => void; track: string };
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={title}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">
          {title}
          {count !== null && <span className={cn(muted, "ml-1.5 font-normal")}>{count}</span>}
        </h2>
        {add && (
          <button
            type="button"
            className="rounded p-1 text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-stone-800"
            onClick={add.onClick}
            aria-label={add.label}
            title={add.label}
            data-track={add.track}
          >
            <Plus size={16} aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-stone-800"
          onClick={onViewAll}
          aria-label={viewAllLabel}
          data-track={track}
        >
          {viewAll}
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <ul className={cn(surface, "divide-y divide-stone-200 dark:divide-stone-700")} data-track-private>
        {children}
      </ul>
    </section>
  );
}

/** How a paired device shows: its kind's icon, and online, offline or paused. */
function deviceOf(link: BrowserLink) {
  const isBrowser = (link.kind ?? "browser") === "browser";
  const device = agentDevice(isBrowser, link.agent_type?.key) ?? { name: link.agent_type?.name ?? "", kind: "other" as const };
  const state: "online" | "offline" | "paused" = link.paused ? "paused" : link.status === "connected" ? "online" : "offline";
  return { device, state };
}

/** A section's message: loading, an error, or that it has none yet. */
function Note({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <li className="p-3">{error ? <div className={errorBanner}>{children}</div> : <span className={cn(muted, "text-sm")}>{children}</span>}</li>;
}

/**
 * Home (the rail's first page, #/home), a dashboard since 2026-11-19 (the person's call; until
 * then Home was the agents' menu and settings, now the Agents page), in two columns:
 * - left, the person's **workspaces** — each opening it — and below them their **agents** — each
 *   with its presence and the device it works on, opening its settings;
 * - right, their **tasks** — each with its kind and last run, opening it — and below them their
 *   **devices** — Wysebee Cloud first, then each paired Mac, Windows PC, Android phone and
 *   browser, with its status, each opening its page on Devices (2026-11-20).
 * Each section shows its count and at most {@link SHOWN} rows; its **View all** opens its page,
 * and Workspaces', Agents' and Tasks' **+** makes one: a workspace or a task on its own page (its
 * start form), an agent here (AddAgentDialog), opening it once added.
 * The links are the presence store's (presence.ts), read again every 30 s while shown.
 */
export function HomeView({
  tasks,
  onOpenWorkspace,
  onOpenAgent,
  onOpenTask,
  onOpenDevice,
  onView,
  onNew,
}: {
  /** The person's tasks, as the Tasks page reads them; null until read. */
  tasks: Task[] | null;
  onOpenWorkspace: (workspace: string) => void;
  /** Open an agent's settings on the Agents page. */
  onOpenAgent: (agent: string) => void;
  onOpenTask: (task: string) => void;
  /** Open a device's page on Devices (`cloud` for Wysebee Cloud). */
  onOpenDevice: (device: string) => void;
  /** A section's View all: its page. */
  onView: (page: "workspaces" | "agents" | "tasks" | "devices") => void;
  /** A section's +: its page's way to start a workspace or a task. (An agent is added here.) */
  onNew: (page: "workspaces" | "tasks") => void;
}) {
  const { t, i18n } = useTranslation();
  const agents = useAgents();
  const workspaces = useWorkspaces();
  const links = useLinks();
  const [addingAgent, setAddingAgent] = useState(false);

  useEffect(() => {
    if (agents.items === null) void loadAgents();
  }, [agents.items]);
  useEffect(() => {
    if (workspaces.items === null) void loadWorkspaces();
  }, [workspaces.items]);

  // Each + in the words its own page uses for it.
  const adds: Partial<Record<"workspaces" | "agents" | "tasks" | "devices", { label: string; onClick: () => void; track: string }>> = {
    workspaces: { label: t("workspaces.nav.add"), onClick: () => onNew("workspaces"), track: "Home new workspace" },
    agents: { label: t("home.nav.addAgent"), onClick: () => setAddingAgent(true), track: "Home add agent" },
    tasks: { label: t("sideNav.createOptions.newTask"), onClick: () => onNew("tasks"), track: "Home new task" },
  };
  const section = (page: "workspaces" | "agents" | "tasks" | "devices", count: number | null, children: ReactNode) => (
    <Column
      title={t(`home.dashboard.${page}`)}
      count={count}
      viewAll={t("home.dashboard.viewAll")}
      viewAllLabel={t(`home.dashboard.viewAll_${page}`)}
      onViewAll={() => onView(page)}
      track={`Home view all ${page}`}
      add={adds[page]}
    >
      {children}
    </Column>
  );
  const now = new Date();
  const sortedTasks = tasks && [...tasks].sort((a, b) => (a.label?.trim() || a.name).localeCompare(b.label?.trim() || b.name));

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {section(
          "workspaces",
          workspaces.items?.length ?? null,
          <>
            {workspaces.error && workspaces.items === null && <Note error>{workspaces.error}</Note>}
            {workspaces.items === null && !workspaces.error && <Note>{t("shell.loading")}</Note>}
            {workspaces.items?.length === 0 && <Note>{t("workspaces.nav.none")}</Note>}
            {(workspaces.items ?? []).slice(0, SHOWN).map((workspace) => (
              <li key={workspace.id}>
                <button type="button" className={cn(row, clickable)} onClick={() => onOpenWorkspace(workspace.id)}>
                  <FolderKanban size={20} className="shrink-0 text-stone-500" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{workspace.name}</span>
                    {workspace.updated_at && (
                      <span className={cn(muted, "block truncate text-xs")}>{t("home.dashboard.changed", { when: ago(workspace.updated_at, now, i18n.language) })}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </>,
        )}
        {section(
          "agents",
          agents.items?.length ?? null,
          <>
            {agents.error && agents.items === null && <Note error>{agents.error}</Note>}
            {agents.items === null && !agents.error && <Note>{t("shell.loading")}</Note>}
            {(agents.items ?? []).slice(0, SHOWN).map((agent) => {
              const device = agentDevice(agent.browser, agent.device);
              return (
                <li key={agent.id}>
                  <button type="button" className={cn(row, clickable)} onClick={() => onOpenAgent(agent.id)}>
                    <AgentAvatar avatar={agent.avatar} label={agent.label} size={32} status={presenceOf(agent, links)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{agent.label}</span>
                      <span className={cn(muted, "block truncate text-xs")}>@{agent.name}</span>
                    </span>
                    {device ? (
                      <DeviceIcon name={device.name} kind={device.kind} size={16} />
                    ) : (
                      <DeviceIcon name={t("home.dashboard.inCloud")} kind="cloud" size={16} />
                    )}
                  </button>
                </li>
              );
            })}
          </>,
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {section(
          "tasks",
          tasks?.length ?? null,
          <>
            {sortedTasks === null && <Note>{t("shell.loading")}</Note>}
            {sortedTasks?.length === 0 && <Note>{t("sideNav.secondary.noTasksYet")}</Note>}
            {(sortedTasks ?? []).slice(0, SHOWN).map((task) => (
              <li key={task.id}>
                <button type="button" className={cn(row, clickable)} onClick={() => onOpenTask(task.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{task.label?.trim() || task.name}</span>
                      <TaskKindIcon trigger={task.trigger} size={13} className="text-stone-400" />
                    </span>
                    <span className={cn(muted, "block truncate text-xs")}>{task.description || task.prompt || t("tasks.list.noPlan")}</span>
                  </span>
                  <StatusBadge status={task.last_run?.status ?? null} />
                </button>
              </li>
            ))}
          </>,
        )}
        {section(
          "devices",
          links === null ? null : links.length + 1,
          <>
            <li>
              <button type="button" className={cn(row, clickable)} onClick={() => onOpenDevice("cloud")}>
                <Cloud size={20} className="shrink-0 text-stone-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">Wysebee Cloud</span>
                  <span className={cn(muted, "block truncate text-xs")}>{t("home.dashboard.cloudHint")}</span>
                </span>
                <Status state="online" />
              </button>
            </li>
            {links === null && <Note>{t("shell.loading")}</Note>}
            {(links ?? []).slice(0, SHOWN - 1).map((link) => {
              const { device, state } = deviceOf(link);
              return (
                <li key={link.id}>
                  <button type="button" className={cn(row, clickable)} onClick={() => onOpenDevice(link.id)}>
                    <DeviceIcon name={device.name} kind={device.kind} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{link.browser || device.name}</span>
                      <span className={cn(muted, "block truncate text-xs")}>{[link.agent_type?.name ?? device.name, link.label].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Status state={state} />
                  </button>
                </li>
              );
            })}
          </>,
        )}
      </div>
      {addingAgent && (
        <AddAgentDialog
          onClose={() => setAddingAgent(false)}
          onAdded={(id) => {
            setAddingAgent(false);
            onOpenAgent(id);
          }}
        />
      )}
    </div>
  );
}
