import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  canCreateConfig,
  createTask,
  deleteTask,
  updateTask,
  type AgentDetail,
  type Task,
  type TaskInput,
  type TaskRunStatus,
  type UserRole,
} from "../../api";
import {
  btn,
  btnPrimary,
  cn,
  errorBanner,
  inputBase,
  loading as loadingCls,
  muted,
  surface,
} from "@shared/cn";
import { AgentConfigPanel } from "../AgentsView/AgentConfigPanel";
import { TaskKindIcon } from "./schedule";
import { ScheduleCard, useScheduleText } from "./ScheduleCard";
import { TASK_TABS, type TaskTab } from "./tabs";
import { RunsTab } from "./Runs";
import { RemindersList } from "./Reminders";

/**
 * Tasks: a plan, carried out in the browser — set up like an agent, but run, not
 * chatted with.
 *
 * Driven from App: App owns the list (the nav reads it too) and the
 * route (`#/tasks/<id>/<tab>` — by id, so a rename keeps the bookmark). This view
 * renders the list, the create form (just a name), or one task's page.
 *
 * **A task's page is the agent page** (AgentConfigPanel with `kind="task"`): General
 * is the agent's own editor over the task's own settings, and Plan is the Instruction
 * editor. A task runs in Wysebee Cloud, on its schedule; there is no Start here — only each
 * task's last outcome on the list.
 */
export function TasksView({
  rows,
  selected,
  tab,
  creating,
  meRole,
  currentUserEmail,
  onSelect,
  onTabChange,
  onChanged,
  onCreate,
}: {
  rows: Task[] | null;
  selected: string | null;
  tab: TaskTab | null;
  creating: boolean;
  meRole: UserRole | null;
  currentUserEmail: string;
  /** Open a task (on a tab), or go back to the list with null. */
  onSelect: (id: string | null, tab?: TaskTab) => void;
  onTabChange: (tab: TaskTab) => void;
  onChanged: () => void | Promise<void>;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  const scheduleText = useScheduleText();
  const canEdit = canCreateConfig(meRole);

  if (creating) {
    return (
      <TaskCreateForm
        onCancel={() => onSelect(null)}
        onCreated={async (task) => {
          await onChanged();
          // A new task has no plan: go there next.
          onSelect(task.id, "plan");
        }}
      />
    );
  }

  const current = rows?.find((r) => r.id === selected) ?? null;
  if (selected && current) {
    return (
      <TaskPage
        key={current.id}
        task={current}
        tab={tab}
        meRole={meRole}
        currentUserEmail={currentUserEmail}
        onTabChange={onTabChange}
        onChanged={onChanged}
        onDeleted={async () => {
          onSelect(null);
          await onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className={cn(muted, "text-sm")}>{t("tasks.list.intro")}</p>
        {canEdit && (
          <button
            type="button"
            className={cn(btnPrimary, "shrink-0")}
            onClick={onCreate}
          >
            {t("tasks.list.add")}
          </button>
        )}
      </div>

      {rows === null && <div className={loadingCls}>{t("tasks.list.loading")}</div>}

      {rows && rows.length === 0 && (
        <div className={cn(surface, "p-6 text-center")}>
          <p className="text-sm font-medium">{t("tasks.list.empty")}</p>
          <p className={cn(muted, "mt-1 text-xs")}>{t("tasks.list.emptyHint")}</p>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div
          className={cn(surface, "divide-y divide-stone-200 dark:divide-stone-700")}
          data-track-private
        >
          {[...rows]
            .sort((a, b) => (a.label?.trim() || a.name).localeCompare(b.label?.trim() || b.name))
            .map((row) => (
              <div key={row.id} className="flex items-center gap-3 pr-4">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left hover:bg-black/5 dark:hover:bg-white/5"
                  onClick={() => onSelect(row.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{row.label?.trim() || row.name}</span>
                      <TaskKindIcon trigger={row.trigger} size={13} className="text-stone-400" />
                    </div>
                    <div className={cn(muted, "truncate text-xs")}>
                      {row.description || row.prompt || t("tasks.list.noPlan")}
                    </div>
                    {row.trigger.type !== "manual" && (
                      <div className={cn(muted, "truncate text-[11px]")}>{scheduleText(row.trigger)}</div>
                    )}
                  </div>
                  <StatusBadge status={row.last_run?.status ?? null} />
                </button>
              </div>
            ))}
        </div>
      )}
      <RemindersList />
    </div>
  );
}

// --- create ---------------------------------------------------------------------------

/** A name is all a task needs to exist; the rest is set up on its page. */
function TaskCreateForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (task: Task) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(t("tasks.form.errors.name"));
    setSaving(true);
    setError(null);
    try {
      // "Task Created" is reported by the server.
      const task = await createTask({ name: name.trim() });
      await onCreated(task);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      <h3 className="text-sm font-semibold">{t("tasks.form.newTitle")}</h3>
      {error && <div className={errorBanner}>{error}</div>}
      <div>
        <label className={labelCls} htmlFor="task-name">{t("tasks.form.name")}</label>
        <input
          id="task-name"
          className={inputBase}
          placeholder={t("tasks.form.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          disabled={saving}
          autoFocus
        />
        <p className={cn(muted, "mt-1 text-[11px]")}>
          {t("tasks.form.nameHelp")}
        </p>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={saving}>
          {saving ? t("tasks.form.saving") : t("tasks.form.create")}
        </button>
        <button type="button" className={btn} onClick={onCancel} disabled={saving}>
          {t("tasks.form.cancel")}
        </button>
      </div>
    </form>
  );
}

const labelCls = "mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400";

// --- one task --------------------------------------------------------------------------

/** The task in the shape the agent page edits: its settings as an agent's config, the
 * plan in the Instruction editor's field. */
function asDetail(task: Task): AgentDetail {
  const config: Record<string, unknown> = { instructions: task.prompt };
  if (task.label) config.label = task.label;
  if (task.browser_access === false) config.browser_access = false;
  if (task.browser) config.browser = task.browser;
  if (task.browser && task.browser_devtools) config.browser_devtools = true;
  return {
    id: task.id,
    agent_name: task.name,
    config,
    system_prompt: "",
    creator: task.creator ?? "",
    creator_name: "",
    created_by: task.created_by ?? null,
    updated_by: task.updated_by ?? null,
    updated_at: task.updated_at,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What the agent page saved, back as a task update. Every field is sent — absent in
 * the page's config means cleared, and an update keeps whatever it is not sent. */
function asInput(config: Record<string, unknown>): TaskInput {
  return {
    label: str(config.label),
    prompt: str(config.instructions),
    browser_access: config.browser_access !== false,
    browser: str(config.browser),
    browser_devtools: config.browser_devtools === true,
  };
}

function TaskPage({
  task,
  tab,
  meRole,
  currentUserEmail,
  onTabChange,
  onChanged,
  onDeleted,
}: {
  task: Task;
  tab: TaskTab | null;
  meRole: UserRole | null;
  currentUserEmail: string;
  onTabChange: (tab: TaskTab) => void;
  onChanged: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const detail = useMemo(() => asDetail(task), [task]);
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{task.label?.trim() || task.name}</h2>
      </div>
      <ScheduleCard task={task} />
      <AgentConfigPanel
        key={task.id}
        tabs={TASK_TABS}
        detail={detail}
        meRole={meRole}
        currentUserEmail={currentUserEmail}
        initialTab={tab}
        onTabChange={(next) => onTabChange(next as TaskTab)}
        extraTabs={{ run: () => <RunsTab taskId={task.id} /> }}
        onSave={async (config) => {
          const saved = await updateTask(task.id, asInput(config));
          await onChanged();
          return asDetail(saved);
        }}
        onDelete={async () => {
          await deleteTask(task.id);
          await onDeleted();
        }}
      />
    </div>
  );
}

const STATUS_STYLE: Record<TaskRunStatus, string> = {
  running: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  succeeded: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  stopped: "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
  interrupted: "bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200",
};

export function StatusBadge({ status }: { status: TaskRunStatus | null }) {
  const { t } = useTranslation();
  if (!status) {
    return <span className={cn(muted, "shrink-0 text-[11px]")}>{t("tasks.status.never")}</span>;
  }
  return (
    <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>
      {t(`tasks.status.${status}`)}
    </span>
  );
}
