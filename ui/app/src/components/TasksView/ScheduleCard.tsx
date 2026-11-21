import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Task, TaskTrigger } from "../../api";
import { loadAgents, useAgents } from "../../agents";
import { cn, muted, surface } from "@shared/cn";
import { TaskKindIcon } from "./schedule";

/** A trigger in the person's words: when it runs. */
export function useScheduleText(): (trigger: TaskTrigger) => string {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  return (trigger) => {
    if (trigger.type === "once" && trigger.at) {
      return t("tasks.schedule.once", { when: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(trigger.at)) });
    }
    if (trigger.type === "recurring") {
      if (trigger.repeat === "minutes" || trigger.repeat === "hours") return t(`tasks.schedule.${trigger.repeat}`, { count: trigger.every ?? 0 });
      const tz = trigger.tz || "UTC";
      if (trigger.repeat === "weekly") {
        // 2026-11-16 was a Monday: day n of the week is that day plus n - 1.
        const names = (trigger.days ?? []).map((d) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 10, 15 + d))));
        return t("tasks.schedule.weekly", { days: names.join(", "), time: trigger.time, tz });
      }
      return t("tasks.schedule.daily", { time: trigger.time, tz });
    }
    return t("tasks.schedule.manual");
  };
}

/**
 * A task's schedule on its page (2026-11-15): when Wysebee Cloud runs it, when it is next due,
 * and its steps — the agent tools it runs, in order — or, with none, that its plan is posted
 * to Activity as a reminder. Set up from the person's AI app through Wysebee Assistant.
 */
export function ScheduleCard({ task }: { task: Task }) {
  const { t, i18n } = useTranslation();
  const scheduleText = useScheduleText();
  const steps = task.steps ?? [];
  // Each step's agent by its handle now (a step keeps its agent by id, so a rename keeps it).
  const agents = useAgents();
  useEffect(() => {
    if (agents.items === null && steps.length > 0) void loadAgents();
  }, [agents.items, steps.length]);
  const handleOf = (id: string | null) => {
    const found = (agents.items ?? []).find((a) => a.id === id);
    return found ? `@${found.name}` : agents.items === null ? "…" : t("tasks.schedule.deletedAgent");
  };
  return (
    <section className={cn(surface, "mb-4 flex flex-col gap-2 p-4")} aria-label={t("tasks.schedule.title")}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <TaskKindIcon trigger={task.trigger} size={15} className="text-stone-500" />
        {scheduleText(task.trigger)}
      </div>
      <p className={cn(muted, "text-xs")}>
        {task.next_run_at
          ? t("tasks.schedule.next", { when: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.next_run_at)) })
          : t("tasks.schedule.notScheduled")}
      </p>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{t("tasks.schedule.steps")}</div>
      {steps.length === 0 ? (
        <p className={cn(muted, "text-xs")}>{t("tasks.schedule.noSteps")}</p>
      ) : (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm" data-track-private>
          {steps.map((step, n) => (
            <li key={n}>
              <span className="font-medium">{handleOf(step.agent_id)}</span> · <code className="text-xs">{step.tool}</code>
              {step.arguments && Object.keys(step.arguments).length > 0 && <code className={cn(muted, "ml-2 break-all text-xs")}>{JSON.stringify(step.arguments)}</code>}
            </li>
          ))}
        </ol>
      )}
      <p className={cn(muted, "text-xs")}>{t("tasks.schedule.via")}</p>
    </section>
  );
}
