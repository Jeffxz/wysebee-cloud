/**
 * Which agent may add which tool (pure), **as Wysebee Cloud's agent types say** (`GET
 * /api/v1/agent-types`, agentTypes.ts — the same rule as apps/cloud/tool_kinds.py): a tool kind
 * some type's `tool_kinds` lists may be added only by an agent of such a type; a kind no type
 * lists is any agent's. **An agent's type** is the type its settings name (`agent_type_id`)
 * while it holds that type's link (`config[link_field]`, set only by the pairing); else it has
 * none (every paired agent has an `agent_type_id` since migration 0050). Wysebee Cloud refuses a save that adds a tool to an agent of another type (422
 * `wrong_agent_kind`); the pages hide what an agent cannot add — all of what some type lists
 * until the types are read.
 */
import type { AgentType } from "../../api";

/** Which agents may have a tool: `any`, or the kinds of device whose types list it. */
export type ToolKind = "any" | string;

const linked = (v: unknown) => typeof v === "string" && v !== "";

/** The types that list a tool kind (none: any agent may have it). */
export function listing(key: string, types: readonly AgentType[]): AgentType[] {
  return types.filter((t) => t.tool_kinds.includes(key));
}

/** The type of an agent with these settings, while it holds its link; else null. */
export function typeOf(config: Record<string, unknown>, types: readonly AgentType[]): AgentType | null {
  return types.find((t) => t.id === config.agent_type_id && linked(config[t.link_field])) ?? null;
}

/** The kind of device an agent was made by pairing (its type's `kind`), else `plain`. */
export function agentKind(config: Record<string, unknown>, types: readonly AgentType[]): string {
  return typeOf(config, types)?.kind ?? "plain";
}

/** Whether an agent with these settings may add the tool; while the types are not read (null),
 * nothing — not even a tool every agent may have. */
export function mayAdd(config: Record<string, unknown>, key: string, types: readonly AgentType[] | null): boolean {
  if (types === null) return false;
  const who = listing(key, types);
  return who.length === 0 || who.some((t) => t === typeOf(config, types));
}

/** Whether an agent of the list (agents.ts: `device`, its paired device's type key — none while
 * unpaired) may be given the tool. */
export function listedMay(agent: { device?: string }, key: string, types: readonly AgentType[]): boolean {
  const who = listing(key, types);
  if (who.length === 0) return true;
  const mine = types.find((t) => t.key === agent.device);
  return !!mine && who.includes(mine);
}

/** The switches an agent with these settings may have: its type's (none without one). */
export function switchesOf(config: Record<string, unknown>, types: readonly AgentType[] | null) {
  return (types && typeOf(config, types)?.settings) || [];
}
