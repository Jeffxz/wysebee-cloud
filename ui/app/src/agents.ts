/**
 * The agents (`/agent/agents`): Wysebee, the app's own, and the ones the person adds — one
 * store, so Home's menu (its Direct messages), the chat's "@" list and the rows' names and
 * pictures always agree. Wysebee comes first, then the person's agents by their label.
 */

import { useSyncExternalStore } from "react";
import { createAgent, deleteAgent, fetchAgents, type AgentSummary } from "./api";
import { registerSensitiveNames } from "./telemetry";

/** The app's own agent. */
export const WYSEBEE = "wysebee";

/** An agent as the chat shows it. */
export interface ChatAgent {
  /** Its id: what its page is reached by, kept when it is renamed. */
  id: string;
  /** Its "@" handle. */
  name: string;
  label: string;
  avatar: string;
  /** Made by pairing the Wysebee Agent browser extension. */
  browser?: boolean;
  /** Made by pairing Wysebee Agent for Mac. */
  mac?: boolean;
  /** While paired, the device's agent type key (`wysebee-windows`, `wysebee-osx`, …). */
  device?: string;
}

interface AgentsState {
  /** Wysebee first; null until first read. */
  items: ChatAgent[] | null;
  error: string | null;
}

let state: AgentsState = { items: null, error: null };
const listeners = new Set<() => void>();

function set(next: Partial<AgentsState>): void {
  state = { ...state, ...next };
  // The person's agents' names never leave in an analytics label (Wysebee's is the app's own).
  registerSensitiveNames((state.items ?? []).filter((a) => a.name !== WYSEBEE).flatMap((a) => [a.name, a.label]));
  listeners.forEach((l) => l());
}

function asChatAgent(row: AgentSummary): ChatAgent {
  return { id: row.id, name: row.agent_name, label: row.label?.trim() || row.agent_name, avatar: row.avatar ?? "", ...(row.browser ? { browser: true } : {}), ...(row.mac ? { mac: true } : {}), ...(row.device ? { device: row.device } : {}) };
}

/** Wysebee first, then by label. */
export function ordered(agents: ChatAgent[]): ChatAgent[] {
  return [...agents].sort((a, b) => (a.name === WYSEBEE ? -1 : b.name === WYSEBEE ? 1 : a.label.localeCompare(b.label)));
}

let loading: Promise<void> | null = null;

/** Read the agents (once at a time). */
export function loadAgents(): Promise<void> {
  loading ??= fetchAgents()
    .then((r) => set({ items: ordered(r.rows.map(asChatAgent)), error: null }))
    .catch((e) => set({ error: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** A new agent of the person's. Throws the server's reason (a name taken, too many). */
export async function addAgent(name: string, label: string): Promise<ChatAgent> {
  const detail = await createAgent(name, label);
  const agent = asChatAgent({ id: detail.id, agent_name: detail.agent_name, updated_at: null, label: detail.config.label as string | undefined });
  set({ items: ordered([...(state.items ?? []), agent]) });
  return agent;
}

/** Delete the agent (by its id). */
export async function removeAgent(id: string): Promise<void> {
  await deleteAgent(id);
  set({ items: (state.items ?? []).filter((a) => a.id !== id) });
}

/** The agent an address names: by its id, or — an older address, or a page that knows only
 * the handle — by its "@" handle. */
export function agentNamed(agents: ChatAgent[], key: string): ChatAgent | undefined {
  return agents.find((a) => a.id === key) ?? agents.find((a) => a.name === key);
}

/** A handle from a label: "Travel Planner" → "travel-planner" (lowercase letters, digits,
 * "-" and "_", starting with a letter, 30 at most); "" when nothing usable is left. */
export function handleFor(label: string): string {
  const slug = label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/-+$/, "");
  return slug;
}

/** Whether a handle has the shape the server takes. */
export function validHandle(name: string): boolean {
  return /^[a-z][a-z0-9_-]{0,29}$/.test(name);
}

/** The agents as last read (null until first read). */
export function agentsNow(): ChatAgent[] | null {
  return state.items;
}

export function useAgents(): AgentsState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** For tests: forget what was read. */
export function resetAgents(): void {
  state = { items: null, error: null };
  loading = null;
}
