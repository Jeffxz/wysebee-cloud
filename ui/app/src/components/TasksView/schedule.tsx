import { useTranslation } from "react-i18next";
import { AlarmClock, Hand, Repeat, type LucideIcon } from "lucide-react";
import type { TaskTrigger } from "../../api";

/**
 * A task's kind, from its trigger — and the one icon each kind has, wherever a task is
 * listed (the nav, the list page, the detail page):
 *
 * - manual    → a hand: someone presses Start;
 * - once      → an alarm clock: a timer;
 * - recurring → repeat arrows.
 */
export type TaskKind = "manual" | "once" | "recurring";

export const taskKind = (trigger: TaskTrigger | null | undefined): TaskKind =>
  trigger?.type === "once" || trigger?.type === "recurring" ? trigger.type : "manual";

const ICONS: Record<TaskKind, LucideIcon> = {
  manual: Hand,
  once: AlarmClock,
  recurring: Repeat,
};

export function TaskKindIcon({
  trigger,
  size = 14,
  className,
}: {
  trigger: TaskTrigger | null | undefined;
  size?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const kind = taskKind(trigger);
  const Icon = ICONS[kind];
  const label = t(`tasks.kind.${kind}`);
  return (
    <span title={label} aria-label={label} role="img" className="inline-flex">
      <Icon size={size} className={className} aria-hidden />
    </span>
  );
}
