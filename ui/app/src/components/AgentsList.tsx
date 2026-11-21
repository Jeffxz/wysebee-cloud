import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { btn, cn, errorBanner, muted } from "@shared/cn";
import { loadAgents, useAgents, type ChatAgent } from "../agents";
import type { BrowserLink } from "../api";
import { presenceOf, useLinks } from "../presence";
import { AddAgentDialog } from "./AddAgentDialog";
import { AgentAvatar } from "./common/AgentAvatar";
import { agentDevice, DeviceIcon } from "./common/DeviceIcon";

type State = "online" | "offline" | "paused";

/** Where `agent` works and whether it can answer now: Wysebee Cloud, always online; or the
 * device or browser it was paired with — online while that polls, paused while the person
 * paused it there. `null` state until the links are read. */
export function whereAgentWorks(agent: ChatAgent, links: BrowserLink[] | null): { device: ReturnType<typeof agentDevice>; link?: BrowserLink; state: State | null } {
  const device = agentDevice(agent.browser, agent.device);
  if (!device) return { device, state: "online" };
  const link = links?.find((l) => l.agent === agent.name);
  const state: State | null = link?.paused ? "paused" : presenceOf(agent, links);
  return { device, link, state };
}

function Status({ state }: { state: State }) {
  const { t } = useTranslation();
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
      <span className={cn("h-2 w-2 rounded-full", state === "online" ? "bg-green-500" : state === "paused" ? "bg-amber-500" : "bg-stone-400")} aria-hidden />
      {t(`home.dashboard.${state}`)}
    </span>
  );
}

/**
 * **All agents** (`#/agents`, 2026-11-20, the person's call: like All devices), the Agents
 * page's list: every agent — Wysebee first, then the person's own — with its picture and
 * presence, its "@" handle, where it works (Wysebee Cloud, or the device or browser it was
 * paired with) and whether it is reached now; each opens its settings (`onOpen`). **Add an
 * agent** adds one (AddAgentDialog) and opens it.
 */
export function AgentsList({ onOpen }: { onOpen: (agent: string) => void }) {
  const { t } = useTranslation();
  const agents = useAgents();
  const links = useLinks();
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (agents.items === null) void loadAgents();
  }, [agents.items]);

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center gap-2">
        <p className={cn(muted, "flex-1 text-xs")}>{t("home.list.intro")}</p>
        <button type="button" className={cn(btn, "flex items-center gap-1 px-2 py-1 text-xs")} onClick={() => setAdding(true)} data-track="Agents list add agent">
          <Plus size={12} aria-hidden />
          {t("home.nav.addAgent")}
        </button>
      </div>
      {agents.error && agents.items === null && <div className={errorBanner}>{agents.error}</div>}
      {agents.items === null && !agents.error && <p className={cn(muted, "text-xs")}>{t("shell.loading")}</p>}
      {agents.items !== null && (
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200 dark:divide-stone-700 dark:border-stone-700" data-track-private>
          {agents.items.map((agent) => {
            const { device, link, state } = whereAgentWorks(agent, links);
            return (
              <li key={agent.id}>
                <button type="button" className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-700/50" onClick={() => onOpen(agent.id)}>
                  <AgentAvatar avatar={agent.avatar} label={agent.label} size={32} status={presenceOf(agent, links)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{agent.label}</span>
                      <span className={cn(muted, "shrink-0 font-normal")}>@{agent.name}</span>
                    </span>
                    <span className={cn(muted, "flex items-center gap-1.5 truncate text-xs")}>
                      {device ? (
                        <>
                          <DeviceIcon name={device.name} kind={device.kind} size={12} />
                          {[link?.agent_type?.name ?? device.name, link?.browser].filter(Boolean).join(" · ")}
                        </>
                      ) : (
                        <>
                          <DeviceIcon name="Wysebee Cloud" kind="cloud" size={12} />
                          {t("home.dashboard.inCloud")}
                        </>
                      )}
                    </span>
                  </span>
                  {state && <Status state={state} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {adding && (
        <AddAgentDialog
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            onOpen(id);
          }}
        />
      )}
    </div>
  );
}
