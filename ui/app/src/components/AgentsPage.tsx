import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type UserRole } from "../api";
import { btnPrimary, cn, errorBanner, loading as loadingCls, muted } from "@shared/cn";
import { agentNamed, loadAgents, useAgents, WYSEBEE } from "../agents";
import { AgentSettings } from "./AgentSettings";

/** The app's own agent (packages/agent_core/settings.py `default_agent_name`). */
export const WYSEBEE_AGENT = WYSEBEE;

/** Every agent's settings tabs: General, Tools, Skills, Instruction and Connect AI app —
 * Wysebee Assistant's address, the agent's tools and its switch for AI apps. */
export const SETTINGS_TABS = [
  ["property", "agents.panel.tabs.property"],
  ["tools", "agents.panel.tabs.tools"],
  ["skills", "agents.panel.tabs.skills"],
  ["instructions", "agents.panel.tabs.instructions"],
  ["mcp", "agents.panel.tabs.mcp"],
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/** The settings tab a URL segment names, or null. `capabilities` was Tools. */
export function settingsTabFromSegment(segment: string | undefined): SettingsTab | null {
  if (segment === "capabilities") return "tools";
  return SETTINGS_TABS.find(([key]) => key === segment)?.[0] ?? null;
}

/**
 * The Agents page (#/agents; Home until 2026-11-19, when Home became a dashboard): **one agent's
 * settings**, the agent picked in its menu (AgentsNav) — Wysebee's unless another is named
 * (#/agents/<id>[/<tab>]; Home's old #/home/agent/<id> addresses, and a handle, still open it). There is
 * no chat (2026-11-14, the person's call: no Hub, topics or direct messages, and no model in
 * Wysebee Cloud); an agent's tools are reached from an AI app, through Wysebee Assistant.
 */
export function AgentsPage({
  meRole,
  currentUserEmail,
  agent = WYSEBEE,
  tab = null,
  onOpen,
}: {
  meRole: UserRole | null;
  currentUserEmail: string;
  /** The agent shown: its id, or its handle. */
  agent?: string;
  /** Its tab; none is General. */
  tab?: SettingsTab | null;
  /** Open an agent's settings, on a tab. */
  onOpen: (agent: string, tab?: SettingsTab) => void;
}) {
  const { t } = useTranslation();
  const agents = useAgents();

  useEffect(() => {
    if (agents.items === null) void loadAgents();
  }, [agents.items]);

  if (agents.error && agents.items === null) return <div className={errorBanner}>{agents.error}</div>;
  if (agents.items === null) return <div className={loadingCls}>{t("shell.loading")}</div>;
  const found = agentNamed(agents.items, agent);
  if (!found) {
    return (
      <div className="m-auto flex flex-col items-center gap-3 text-center">
        <p className={cn(muted, "text-sm")}>{t("home.agentGone")}</p>
        <button type="button" className={btnPrimary} onClick={() => onOpen(WYSEBEE)} data-track="Agents agent gone back">
          {t("home.backToWysebee")}
        </button>
      </div>
    );
  }

  return (
    <AgentSettings
      // A new agent: its own settings, read afresh.
      key={found.id}
      agentId={found.id}
      agentName={found.name}
      tab={tab}
      onTabChange={(next) => onOpen(found.id, next)}
      onDeleted={() => {
        void loadAgents();
        onOpen(WYSEBEE);
      }}
      meRole={meRole}
      currentUserEmail={currentUserEmail}
    />
  );
}
