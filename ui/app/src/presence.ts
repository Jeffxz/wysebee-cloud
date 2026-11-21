/**
 * Whether an agent can answer now — **online** or **offline**, shown as a dot on its picture,
 * as Slack shows a person. Every agent lives in Wysebee Cloud, so it is online — but **an agent
 * made by pairing a browser works in that browser** (2026-11-13, the person's call): online
 * while its Wysebee Agent extension polls Wysebee Cloud and is not paused, offline otherwise.
 * So, since 2026-11-19, does **an agent paired with a Mac, a Windows PC or an Android phone**:
 * offline while that device is (the person's call — its tools are that device's).
 * The links are read from `/api/v1/browser-links`, again every 30 s while something shows a
 * presence.
 */

import { useEffect, useSyncExternalStore } from "react";
import { fetchBrowserLinks, type BrowserLink } from "./api";

export type Presence = "online" | "offline";

/** How often the links are read again while a presence shows. */
export const PRESENCE_REFRESH_MS = 30_000;

/** Who an agent is, for its presence: by its handle, whether a browser was paired with it,
 * and the type of the device it is paired with while it is (`wysebee-osx`, …). */
export interface PresenceAgent {
  name: string;
  browser?: boolean;
  device?: string;
}

/** An agent's presence: online — or, for an agent paired with a browser or a device, as that
 * link says: online while it polls and is not paused (unknown, null, until the links are read). */
export function presenceOf(agent: PresenceAgent, all: BrowserLink[] | null): Presence | null {
  const onDevice = !agent.browser && !!agent.device;
  if (!agent.browser && !onDevice) return "online";
  if (!all) return null;
  const link = all.find((l) => l.agent === agent.name && ((l.kind ?? "browser") === "browser") === !onDevice);
  return link && link.status === "connected" && !link.paused ? "online" : "offline";
}

let links: BrowserLink[] | null = null;
const listeners = new Set<() => void>();
let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** Read the paired browsers again; a failure keeps the last list. */
export async function refreshLinks(): Promise<void> {
  try {
    links = (await fetchBrowserLinks()).links;
    listeners.forEach((l) => l());
  } catch {
    /* offline or signed out: the last list stands */
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The person's links, read now and every 30 s while any caller is mounted. */
export function useLinks(): BrowserLink[] | null {
  useEffect(() => {
    if (watchers++ === 0) {
      void refreshLinks();
      timer = setInterval(() => void refreshLinks(), PRESENCE_REFRESH_MS);
    }
    return () => {
      if (--watchers === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return useSyncExternalStore(subscribe, () => links);
}

/** For tests: forget the list. */
export function resetPresence(): void {
  links = null;
}
