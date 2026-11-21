/**
 * The page's look: **dark** (the default) or **light**, switched on the rail
 * (`Sidebar`), as in Wysebee Desktop. Applied by the `dark` class on `<html>`, which the
 * stylesheet's `dark:` variant reads (styles.css), and the page's `color-scheme`. Kept with
 * Wysebee's settings in Wysebee Cloud (`/api/v1/config/appearance`, cloud/home.ts) — the
 * desktop's own — so one switch follows the person everywhere, and cached in this browser
 * so the first paint is already in it.
 */

import { useSyncExternalStore } from "react";
import { fetchAppearance, saveAppearance } from "./api";

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

const CACHE_KEY = "wysebee.theme";

const isTheme = (v: unknown): v is Theme => THEMES.includes(v as Theme);

let current: Theme = "dark";
const listeners = new Set<() => void>();

function cachedTheme(): Theme {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    return isTheme(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

/** Show a look now (anything unknown is dark), and remember it for the next visit. */
export function applyTheme(setting: unknown): void {
  current = isTheme(setting) ? setting : "dark";
  try {
    localStorage.setItem(CACHE_KEY, current);
  } catch {
    // Storage blocked: the next visit starts dark.
  }
  const root = document.documentElement;
  root.classList.toggle("dark", current === "dark");
  root.style.colorScheme = current;
  listeners.forEach((l) => l());
}

/** At startup, before the first render: the cached look, until the saved one is read. */
export function startTheme(): void {
  applyTheme(cachedTheme());
}

/** Read the saved look (Wysebee's settings) and show it. Quiet when it cannot be read: the
 * cached one stays. */
export async function loadTheme(): Promise<void> {
  try {
    applyTheme((await fetchAppearance()).theme);
  } catch {
    /* Offline: the look already shown stays. */
  }
}

/** Switch the look: at once here, then saved to the cloud — rejects when that fails, and
 * the look switched to stays (it is cached in this browser). */
export async function setTheme(next: Theme): Promise<void> {
  applyTheme(next);
  await saveAppearance(next);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
