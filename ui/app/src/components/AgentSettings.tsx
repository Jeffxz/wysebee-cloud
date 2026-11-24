import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { canEditCreated, fetchAgentDetail, saveAgentConfig, type AgentDetail, type UserRole } from "../api";
import { btn, cn, errorBanner, inputBase, loading as loadingCls, muted } from "@shared/cn";
import { loadAgents, removeAgent, validHandle, WYSEBEE } from "../agents";
import { AgentAvatar } from "./common/AgentAvatar";
import { AgentAvatarModal } from "./AgentsView/AgentAvatarModal";
import { SaveBar } from "./common/autoSave";
import { InstructionsTab } from "./AgentsView/InstructionsTab";
import { ToolCards } from "./AgentsView/ToolCards";
import { ConnectAiApp } from "./AgentsView/ConnectAiApp";
import { Connections } from "./AgentsView/Connections";
import { SkillsTab } from "./AgentsView/SkillsTab";
import { AVATAR_FIELD, INSTRUCTIONS_FIELD, LABEL_FIELD } from "./AgentsView/shared";
import { SETTINGS_TABS, type SettingsTab } from "./AgentsPage";
import { MadeBy } from "./MadeBy";
import { Hint } from "./common/Hint";
import { dialogs } from "./common/confirm";

/**
 * An agent's settings, Home's page (2026-11-14: there is no chat, so Home is each agent's
 * settings, picked in Home's menu): **General** — its picture, its **database connections**
 * (Connections.tsx: not tools the AI sees, reached through its SQL Query tools), and for the
 * person's own agents their name, their "@" handle (renaming keeps everything: it is reached by
 * id) and Delete; **Tools**, **Skills**, **Instruction** and **Connect AI app**. Edits
 * wait for the Unsaved changes bar; saving writes the agent's settings in Wysebee Cloud.
 */
/** The owner's instructions in a config ("" when none). */
const instructionsOf = (config: Record<string, unknown>) => (typeof config[INSTRUCTIONS_FIELD] === "string" ? (config[INSTRUCTIONS_FIELD] as string) : "");

export function AgentSettings({
  agentId,
  agentName = WYSEBEE,
  tab: asked,
  onTabChange,
  onDeleted,
  meRole,
  currentUserEmail,
}: {
  /** Whose settings: the agent's id. */
  agentId: string;
  /** Its "@" handle, as last read. */
  agentName?: string;
  /** The tab shown; none is General. */
  tab?: SettingsTab | null;
  /** One of the person's agents was deleted here: Home goes back to Wysebee. */
  onDeleted: () => void;
  onTabChange: (tab: SettingsTab) => void;
  meRole: UserRole | null;
  currentUserEmail: string;
}) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  // Its new "@" handle, while one is being typed.
  const [handle, setHandle] = useState<string | null>(null);

  const wysebee = agentName === WYSEBEE;
  const tab = asked ?? SETTINGS_TABS[0][0];

  useEffect(() => {
    fetchAgentDetail(agentId)
      .then((d) => {
        setDetail(d);
        setDraft(d.config);
      })
      // The API rejects with an Error (api.ts).
      .catch((e: Error) => setError(e.message));
  }, [agentId]);

  const renamed = !!detail && handle !== null && handle !== detail.agent_name;
  const dirty = !!detail && (JSON.stringify(draft) !== JSON.stringify(detail.config) || renamed);

  // Escape closes the avatar picker.
  useEffect(() => {
    if (!avatarOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAvatarOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [avatarOpen]);

  const save = async () => {
    if (renamed && !validHandle(handle)) {
      setError(t("agents.general.handleInvalid"));
      return;
    }
    setSaving(true);
    try {
      const saved = await saveAgentConfig(agentId, draft as Record<string, unknown>, renamed ? handle : undefined);
      setDetail(saved);
      setDraft(saved.config);
      setHandle(null);
      setError(null);
      // Its name or picture shows in Home's menu.
      void loadAgents();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const config = draft ?? {};
  const label = detail ? (detail.config[LABEL_FIELD] as string | undefined)?.trim() || detail.agent_name : "";
  const avatar = detail && typeof detail.config[AVATAR_FIELD] === "string" ? (detail.config[AVATAR_FIELD] as string) : "";
  const canEdit = detail ? canEditCreated(meRole, currentUserEmail, detail.creator) : false;
  const instructions = instructionsOf(config);

  // The avatar is saved on pick, as on the desktop: on top of the settings as saved, so
  // edits waiting for the bar stay as they are, and kept in them.
  const applyAvatar = async (next: string) => {
    const withAvatar = (c: Record<string, unknown>) => {
      const { [AVATAR_FIELD]: _old, ...rest } = c;
      return next ? { ...rest, [AVATAR_FIELD]: next } : rest;
    };
    const saved = await saveAgentConfig(agentId, withAvatar((detail as AgentDetail).config));
    setDetail(saved);
    setDraft((d) => withAvatar(d as Record<string, unknown>));
    void loadAgents();
  };

  const remove = async () => {
    if (!(await dialogs.confirm(t("agents.general.confirmDelete", { name: label }), { action: "delete" }))) return;
    try {
      await removeAgent(agentId);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={wysebee ? t("home.settings.title") : t("home.settings.agentTitle", { name: label || agentName })}>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onDiscard={() => {
          setDraft((detail as AgentDetail).config);
          setHandle(null);
          setError(null);
        }}
      />
      <header className="flex items-center gap-3 border-b border-stone-200 pb-3 dark:border-stone-700">
        {detail && <AgentAvatar avatar={avatar} label={label} size={40} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">{label || t("home.settings.title")}</h1>
          <p className={cn(muted, "text-xs")}>{t("home.settings.agentSubtitle", { name: detail?.agent_name ?? agentName })}</p>
        </div>
      </header>
        <div className="flex gap-1 border-b border-stone-200 dark:border-stone-700" role="tablist">
          {SETTINGS_TABS.map(([key, labelKey]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === key ? "border-primary-600 text-primary-700 dark:text-primary-300" : "border-transparent text-stone-500")}
              onClick={() => onTabChange(key)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {error && <div className={errorBanner}>{error}</div>}
          {!detail ? (
            !error && <div className={loadingCls}>{t("shell.loading")}</div>
          ) : tab === "property" ? (
            <div className="flex flex-col gap-6">
              {/* Its picture, and beside it its label and @handle (Wysebee's own has neither to change). */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="flex items-start gap-4">
                  <AgentAvatar avatar={avatar} label={label} size={64} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t("agents.general.avatar")}</div>
                    <p className={cn(muted, "mb-2 text-xs")}>{t("agents.general.avatarHelp")}</p>
                    {canEdit && (
                      <button type="button" className={btn} onClick={() => setAvatarOpen(true)} data-track="Change agent avatar">
                        {t("agents.general.changeAvatar")}
                      </button>
                    )}
                  </div>
                </div>
                {!wysebee && (
                <div className="flex min-w-0 flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t("agents.general.label")}</span>
                  <input
                    className={inputBase}
                    aria-label={t("agents.general.label")}
                    value={typeof config[LABEL_FIELD] === "string" ? (config[LABEL_FIELD] as string) : ""}
                    placeholder={t("agents.general.labelPlaceholder")}
                    onChange={(e) => setDraft({ ...config, [LABEL_FIELD]: e.target.value })}
                    disabled={!canEdit}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    {t("agents.general.handle")}
                    <Hint text={t("agents.general.handleHelp")} />
                  </span>
                  <input
                    className={cn(inputBase, "font-mono")}
                    aria-label={t("agents.general.handle")}
                    value={handle ?? detail.agent_name}
                    onChange={(e) => setHandle(e.target.value.trim().toLowerCase())}
                    disabled={!canEdit}
                  />
                </label>
                </div>
                )}
              </div>
              {/* Its database connections: what its SQL Query tools query. */}
              {detail.id && <Connections agentId={detail.id} canEdit={canEdit} />}
              {/* No Home picker (2026-11-12): an agent lives where it was made, and that
                  cannot be changed. */}
              {!wysebee && (
              <>
              {canEdit && (
                <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-700">
                  <span className={cn(muted, "text-xs")}>{t("agents.general.deleteHelp")}</span>
                  <button type="button" className={cn(btn, "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400")} onClick={() => void remove()}>
                    {t("agents.general.delete")}
                  </button>
                </div>
              )}
              </>
              )}
              {/* Who made it and changed it last: stamped by Wysebee Cloud, display only. */}
              <MadeBy made={detail.created_by} changed={detail.updated_by} me={currentUserEmail} />
            </div>
          ) : tab === "tools" ? (
            <ToolCards config={config} onChange={setDraft} canEdit={canEdit} agentId={detail.id} onConnect={() => onTabChange("property")} onInstructions={() => onTabChange("instructions")} />
          ) : tab === "skills" ? (
            <SkillsTab agentId={detail.id} canEdit={canEdit} />
          ) : tab === "mcp" ? (
            <ConnectAiApp agentName={detail.agent_name} />
          ) : (
            <InstructionsTab
              saved={instructionsOf(detail.config)}
              draft={instructions}
              onDraftChange={(v) => setDraft({ ...config, [INSTRUCTIONS_FIELD]: v })}
              onSave={save}
              canEdit={canEdit}
            />
          )}
        </div>
      {avatarOpen && <AgentAvatarModal avatar={avatar} label={label} onApply={applyAvatar} onClose={() => setAvatarOpen(false)} />}
    </section>
  );
}
