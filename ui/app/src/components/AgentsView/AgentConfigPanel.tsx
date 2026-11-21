import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SaveBar } from "../common/autoSave";
import type { AgentDetail, UserRole } from "../../api";
import { canEditCreated } from "../../api";
import { btn, cn, errorBanner, inputBase, kvKey, kvRow, muted, surface } from "@shared/cn";
import {
  AUTHORIZATION_CONFIG_FIELD,
  AUTHORIZATION_FIELD,
  CREATOR_FIELD,
  DATABASE_FIELD,
  DATABASE_WRITE_FIELD,
  INSTRUCTIONS_FIELD,
  LABEL_FIELD,
  LOCAL_FOLDERS_FIELD,
  TOOLS_FIELD,
  WORKSPACE_FIELD,
} from "./shared";
import { InstructionsTab } from "./InstructionsTab";
import { MadeBy } from "../MadeBy";
import { dialogs } from "../common/confirm";

// Every tab renders in the same shell: a plain surface card. The tab strip above
// names it — there is deliberately no heading in here, or the name would appear
// twice.
function TabPanel({ children }: { children: React.ReactNode }) {
  return <div className={cn(surface, "p-4")}>{children}</div>;
}

/**
 * A task's page (TasksView/TaskPage): General — what it is, its label, Delete — then its
 * Plan. What else the task carries is kept untouched by a save here.
 */
export function AgentConfigPanel({
  detail,
  meRole,
  currentUserEmail,
  onSave,
  onDelete,
  initialTab,
  onTabChange,
  tabs,
  extraTabs,
}: {
  detail: AgentDetail;
  meRole: UserRole | null;
  currentUserEmail: string;
  onSave: (config: Record<string, unknown>) => Promise<AgentDetail>;
  onDelete: () => Promise<void>;
  /** Which tab to open on. From the URL, so a link can point at one. */
  initialTab?: string | null;
  onTabChange?: (tab: string) => void;
  /** The tab strip: [key, i18n label key]. */
  tabs: ReadonlyArray<readonly [string, string]>;
  /** Tabs drawn by their owner (a task's Run), by key. */
  extraTabs?: Record<string, () => React.ReactNode>;
}) {
  const { t } = useTranslation();
  // Admins edit any task; editors only the ones they created. The backend enforces the
  // same rule — this just hides affordances.
  const canEdit = canEditCreated(meRole, currentUserEmail, detail.creator);
  const [label, setLabel] = useState(() =>
    typeof detail.config[LABEL_FIELD] === "string" ? (detail.config[LABEL_FIELD] as string) : "",
  );
  // The Plan tab's markdown: what is saved, and the draft being edited, which is what
  // Save sends. Here rather than in the tab so switching tabs keeps it.
  const [instructions, setInstructions] = useState<string>(() =>
    typeof detail.config[INSTRUCTIONS_FIELD] === "string" ? (detail.config[INSTRUCTIONS_FIELD] as string) : "",
  );
  const [instructionsDraft, setInstructionsDraft] = useState(instructions);
  const [activeTab, setActiveTab] = useState<string>(initialTab ?? tabs[0][0]);
  // Report the tab outward so the URL keeps saying which one is open, and follow the
  // URL when it changes from elsewhere — a link or the back button.
  const selectTab = (tab: string) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);
  // Everything not edited here — the model, the browser — written back untouched, since
  // a save replaces the whole config.
  const [rest] = useState<Record<string, unknown>>(() => {
    const {
      [CREATOR_FIELD]: _omitCreator,
      [LABEL_FIELD]: _omitLabel,
      [INSTRUCTIONS_FIELD]: _omitInstructions,
      // Keys from older versions that nothing reads — an access gate, the surfaces an
      // agent was served on, a workspace, authored tools, a database connection, local
      // folders. Dropped so a stale one is never re-saved.
      [AUTHORIZATION_FIELD]: _omitAuth,
      [AUTHORIZATION_CONFIG_FIELD]: _omitAuthConfig,
      entry_points: _omitEntryPoints,
      [WORKSPACE_FIELD]: _omitWorkspace,
      [TOOLS_FIELD]: _omitTools,
      [DATABASE_FIELD]: _omitDatabase,
      [DATABASE_WRITE_FIELD]: _omitDatabaseWrite,
      [LOCAL_FOLDERS_FIELD]: _omitLocalFolders,
      ...other
    } = detail.config;
    return other;
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!(await dialogs.confirm(t("tasks.general.confirmDelete", { name: detail.agent_name }), { action: "delete" }))) return;
    setDeleting(true);
    setError(null);
    try {
      // On success the parent navigates away from this (now-unmounted) panel.
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("tasks.general.deleteFailed"));
      setDeleting(false);
    }
  };

  const buildConfig = (): Record<string, unknown> => {
    const config: Record<string, unknown> = { ...rest };
    // Omitted when empty: absent means cleared, since `rest` drops each of them.
    if (label.trim()) config[LABEL_FIELD] = label.trim();
    if (instructionsDraft.trim()) config[INSTRUCTIONS_FIELD] = instructionsDraft;
    return config;
  };

  // **Nothing is saved until Save.** Every edit is held, and the Unsaved changes bar at
  // the top offers Save and Discard. The config is replaced whole by a save, so a
  // half-made set of changes never goes out.
  const config = buildConfig();
  // The config as last saved: what "unsaved" is measured against and Discard restores.
  const [saved, setSaved] = useState<Record<string, unknown>>(() => config);
  const dirty = canEdit && JSON.stringify(config) !== JSON.stringify(saved);

  const saveNow = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await onSave(config);
      setSaved(config);
      setInstructions(instructionsDraft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Put every field back to what is saved. */
  const discardNow = () => {
    const str = (key: string) => (typeof saved[key] === "string" ? (saved[key] as string) : "");
    setLabel(str(LABEL_FIELD));
    setInstructions(str(INSTRUCTIONS_FIELD));
    setInstructionsDraft(str(INSTRUCTIONS_FIELD));
    setError(null);
  };

  return (
    <div className="min-w-0">
      {/* Unsaved changes: floats at the top of the window, on every tab. */}
      <SaveBar dirty={dirty} saving={submitting} onSave={() => void saveNow()} onDiscard={discardNow} />

      {/* Tabs carry the primary colour themselves and sit on top of the panel like
          folder tabs. The selected one is the solid fill; the rest are the same hue
          at card strength, so the strip reads as one control. */}
      <div className="mt-4 flex flex-wrap gap-1">
        {tabs.map(([key, labelKey]) => (
          <button
            key={key}
            type="button"
            className={cn(
              "rounded-t-md px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === key
                ? "bg-primary-700 text-white dark:bg-primary-800"
                : "bg-primary-100 text-primary-800 hover:bg-primary-200 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60",
            )}
            onClick={() => selectTab(key)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {activeTab === "property" && (
        <TabPanel>
          <div className="max-w-xl min-w-0">
            <div className={kvRow}>
              <span className={kvKey}>task_name</span>
              <span className="font-mono">{detail.agent_name}</span>
            </div>
            {/* The row's id: stable across renames, which the name is not. */}
            <div className={kvRow}>
              <span className={kvKey}>task_id</span>
              <span className="font-mono">{detail.id || "—"}</span>
            </div>
            <div className={kvRow}>
              <span className={kvKey}>updated_at</span>
              <span>{detail.updated_at ? new Date(detail.updated_at).toLocaleString() : "—"}</span>
            </div>
            {/* Who made it and changed it last: stamped by the server, display only. */}
            <MadeBy made={detail.created_by} changed={detail.updated_by} me={currentUserEmail} className="mt-2 text-xs text-stone-500 dark:text-stone-400" />
            <div className="mt-4 min-w-0">
              <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400" htmlFor="agent-label">
                {t("agents.general.label")}
              </label>
              <input
                id="agent-label"
                className={inputBase}
                placeholder={t("tasks.general.labelPlaceholder")}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={!canEdit}
                readOnly={!canEdit}
              />
            </div>
            {canEdit && (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-700">
                <div className={cn(muted, "text-xs")}>{t("tasks.general.deleteHelp")}</div>
                <button
                  type="button"
                  className={cn(
                    btn,
                    "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950",
                  )}
                  onClick={handleDelete}
                  disabled={submitting || deleting}
                  title={t("tasks.general.deleteTitle")}
                >
                  {deleting ? t("agents.general.deleting") : t("tasks.general.delete")}
                </button>
              </div>
            )}
          </div>
        </TabPanel>
      )}

      {extraTabs?.[activeTab] && <TabPanel>{extraTabs[activeTab]()}</TabPanel>}

      {activeTab === "plan" && (
        <TabPanel>
          <InstructionsTab
            saved={instructions}
            draft={instructionsDraft}
            onDraftChange={setInstructionsDraft}
            onSave={() => void saveNow()}
            canEdit={canEdit}
            kind="task"
            showActions={false}
          />
        </TabPanel>
      )}

      {error && <div className={cn(errorBanner, "mt-3")}>{error}</div>}

      {!canEdit && (
        <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">
          {meRole === "AGENT_EDITOR" ? t("tasks.general.readOnlyEditor") : t("tasks.general.readOnlyViewer")}
        </div>
      )}
    </div>
  );
}
