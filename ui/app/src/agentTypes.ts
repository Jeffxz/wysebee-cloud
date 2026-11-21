/**
 * The agent types (`GET /api/v1/agent-types`): which kinds of device can pair, and — from Wysebee
 * Cloud, since the agent type packs (2026-11-21) — which tools and switches each type's agents may
 * have. One store, read once and shared (the Tools tab, the Tools page); null until read, and
 * again read on the next use after a failure.
 */

import { useEffect, useSyncExternalStore } from "react";
import { fetchAgentTypes, type AgentType } from "./api";

let types: AgentType[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: AgentType[] | null): void {
  types = next;
  listeners.forEach((l) => l());
}

/** Read the types (once at a time; again after a failure). */
export function loadAgentTypes(): Promise<void> {
  loading ??= fetchAgentTypes().then(
    (r) => set(r.types),
    () => {
      loading = null;
    },
  );
  return loading;
}

/** Forget them (tests, and a change of account). */
export function forgetAgentTypes(): void {
  loading = null;
  set(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The types, read on first use: null until they are. */
export function useAgentTypes(): AgentType[] | null {
  const now = useSyncExternalStore(subscribe, () => types);
  useEffect(() => {
    if (now === null) void loadAgentTypes();
  }, [now]);
  return now;
}
