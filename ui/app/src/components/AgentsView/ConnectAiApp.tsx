import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Info } from "lucide-react";
import { cn, errorBanner, muted } from "@shared/cn";
import { fetchMcpStatus, setMcpAgentExposed, type McpStatus, type McpTool } from "../../api";
import { Copyable } from "../common/Copyable";

/**
 * An agent's **Connect AI app** (every agent's, Wysebee's included): the address the person's
 * own AI app (Claude, ChatGPT) adds once as a custom connector — **Wysebee Assistant**,
 * `/assistant/mcp` in Wysebee Cloud (apps/cloud/agent_mcp.py), the same for every agent
 * (2026-11-14, the person's call: one connector) — this agent's tools as the AI app gets
 * them, and a switch: turned off, the AI app neither sees nor uses this agent. The tools run
 * in the cloud itself: a browser through the Wysebee Agent extension, a Mac through Wysebee
 * Agent for Mac, nothing through Wysebee Desktop.
 */
export function ConnectAiApp({ agentName }: { agentName: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetchMcpStatus(agentName).then(
      (s) => live && (setStatus(s), setError(null)),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [agentName]);

  // The switch: drawn only once the state is read.
  const toggle = async () => {
    const before = status!;
    setBusy(true);
    setError(null);
    setStatus({ ...before, exposed: !before.exposed });
    try {
      await setMcpAgentExposed(agentName, !before.exposed);
    } catch (e) {
      setStatus(before);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = t("agents.aiApp.title");
  const chip = !status ? null : !status.exposed ? "off" : status.offline ? "unavailable" : "ready";
  return (
    <div className="max-w-2xl space-y-4 text-sm">
      <p className="text-stone-700 dark:text-stone-300">{t("agents.aiApp.description")}</p>
      {error && <div className={cn(errorBanner, "text-xs")}>{error}</div>}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-medium">{title}</span>
            <button
              type="button"
              className={cn("rounded-full p-0.5 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-700 dark:hover:text-stone-100", about ? "text-primary-600 dark:text-primary-400" : "text-stone-500 dark:text-stone-400")}
              onClick={() => setAbout(!about)}
              aria-label={t("agents.aiApp.about", { name: title })}
              aria-expanded={about}
              title={t("agents.aiApp.about", { name: title })}
              data-track="Connect AI app about"
            >
              <Info size={16} aria-hidden />
            </button>
          </div>
          {about && (
            <div className="mt-1 space-y-2 text-sm text-stone-700 dark:text-stone-300">
              <p>{t("agents.aiApp.howTo")}</p>
              <p className="text-amber-700 dark:text-amber-400">{t("agents.aiApp.privacy")}</p>
            </div>
          )}
        </div>
        {chip && (
          <span
            role="status"
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
              chip === "ready" ? "bg-green-500/15 text-green-700 dark:text-green-300" : "bg-stone-500/10 text-stone-500 dark:text-stone-400",
            )}
          >
            {t(chip === "ready" ? "agents.aiApp.ready" : chip === "off" ? "agents.aiApp.hidden" : "agents.aiApp.unavailable")}
          </span>
        )}
      </div>
      {status && (
        <div className="space-y-3 rounded-lg border border-stone-200 p-4 dark:border-stone-700">
          <div className="space-y-1">
            <div className={muted}>{t("agents.aiApp.urlLabel")}</div>
            <Copyable value={status.url} label={t("agents.aiApp.address")} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>{t("agents.aiApp.expose")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={status.exposed}
              aria-label={t("agents.aiApp.expose")}
              title={t(status.exposed ? "agents.aiApp.exposed" : "agents.aiApp.hidden")}
              disabled={busy}
              className={cn("relative flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-60", status.exposed ? "bg-primary-600" : "bg-stone-300 dark:bg-stone-600")}
              onClick={() => void toggle()}
              data-track="Connect AI app expose agent"
            >
              <span className={cn("h-4 w-4 rounded-full bg-white shadow transition-transform", status.exposed && "translate-x-4")} aria-hidden />
            </button>
          </div>
          {status.exposed ? (
            <p>{t("agents.aiApp.offers", { tools: status.tools.length, skills: status.skills })}</p>
          ) : (
            <p className={muted}>{t("agents.aiApp.offNote")}</p>
          )}
          {status.offline && status.exposed && <p className="text-amber-700 dark:text-amber-400">{status.offline}</p>}
          {status.tools.length > 0 ? (
            <ToolList tools={status.tools} summary={t("agents.aiApp.toolCount", { count: status.tools.length })} />
          ) : (
            <p className={cn("text-xs", muted)}>{t("agents.aiApp.noTools")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Tools, folded under a summary: each one's name and what it does. */
function ToolList({ tools, summary }: { tools: McpTool[]; summary: string }) {
  return (
    <details className="group rounded-lg border border-stone-200 dark:border-stone-700">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-stone-600 dark:text-stone-300 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="shrink-0 transition-transform group-open:rotate-90" aria-hidden />
        {summary}
      </summary>
      <ul className="space-y-1.5 border-t border-stone-200 px-3 py-2 dark:border-stone-700">
        {tools.map((tool) => (
          <li key={tool.name} className="text-xs">
            <code className="font-mono text-stone-800 dark:text-stone-100">{tool.name}</code>
            {tool.description && <span className={cn("ml-2", muted)}>{tool.description}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
