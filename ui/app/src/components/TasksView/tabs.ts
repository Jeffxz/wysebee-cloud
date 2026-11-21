/**
 * A task's tabs. A task's page is the agent page (AgentsView/AgentConfigPanel) with
 * these: General, Plan (the Instruction editor) and Run (its runs, as Wysebee Desktop
 * recorded them — nothing runs on the web, so it is last, not first as on the desktop).
 * The second element is an i18n key.
 */
export const TASK_TABS = [
  ["property", "tasks.tabs.general"],
  ["plan", "tasks.tabs.plan"],
  ["run", "tasks.tabs.run"],
] as const;

export type TaskTab = (typeof TASK_TABS)[number][0];

/** The tab a URL segment names, or null when it names none. */
export function taskTabFromSegment(segment: string | undefined): TaskTab | null {
  const match = TASK_TABS.find(([key]) => key === segment);
  return match ? match[0] : null;
}
