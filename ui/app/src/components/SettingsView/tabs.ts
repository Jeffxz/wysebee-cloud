/**
 * The web's Settings panes, and which one a URL names — apart from the view, so App can read
 * a route without loading it.
 */

/** The web's Settings panes, in order: the first is where a bare #/settings opens. */
export const SETTINGS_TABS = [
  // The settings that follow the person: Send usage analytics. (Connections, Wysebee Cloud
  // and the person's devices, is Devices on the rail since 2026-11-04, as on the desktop.)
  ["system", "sideNav.secondary.settingsSystem"],
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

/** The pane a URL segment names; anything else (the desktop's own panes, the AI Providers
 * pane there was until 2026-11-03) is the first. Connections' old addresses are Devices'
 * (App's routes). */
export function settingsTabFromSegment(segment: string | undefined): SettingsTab {
  return SETTINGS_TABS.find(([key]) => key === segment)?.[0] ?? SETTINGS_TABS[0][0];
}
