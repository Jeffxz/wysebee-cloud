import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, errorBanner, loading as loadingCls, muted } from "@shared/cn";
import { chatItems, ToolCalls } from "@shared/ToolCalls";
import { fetchTaskRun, fetchTaskRuns, type TaskRun } from "../../api";
import { AssistantText, useToolLabels } from "../common/AssistantText";
import { StatusBadge } from "./index";

/**
 * A task's runs, as Wysebee Cloud recorded them: newest first, each with how it ended, when,
 * and what started it; one opened shows its report and the steps it took. Read only.
 */
export function RunsTab({ taskId }: { taskId: string }) {
  const { t, i18n } = useTranslation();
  const labels = useToolLabels();
  const [runs, setRuns] = useState<TaskRun[] | null>(null);
  const [open, setOpen] = useState<TaskRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTaskRuns(taskId)
      .then((r) => setRuns(r.rows))
      .catch((e: Error) => setError(e.message));
  }, [taskId]);

  const show = (id: string) =>
    fetchTaskRun(taskId, id)
      .then(setOpen)
      .catch((e: Error) => setError(e.message));
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(i18n.language) : "");

  return (
    <div className="flex flex-col gap-3">
      <p className={cn(muted, "text-xs")}>{t("tasks.web.runsNote")}</p>
      {error && <div className={errorBanner}>{error}</div>}
      {runs === null && !error && <div className={loadingCls}>{t("shell.loading")}</div>}
      {runs?.length === 0 && <p className={cn(muted, "text-sm")}>{t("tasks.web.noRuns")}</p>}
      {runs && runs.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-700 dark:border-stone-700">
          {runs.map((r) => (
            <li key={r.id}>
              <button type="button" className={cn("flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-black/5", open?.id === r.id && "bg-black/5")} onClick={() => void show(r.id)}>
                <StatusBadge status={r.status} />
                <span className="flex-1">{when(r.started_at)}</span>
                <span className={cn(muted, "text-xs")}>{t(r.trigger === "schedule" ? "tasks.web.bySchedule" : "tasks.web.byHand")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-2" data-track-private>
          {open.error && <div className={errorBanner}>{open.error}</div>}
          {open.output && <AssistantText text={open.output} />}
          <ToolCalls steps={chatItems(open.messages ?? []).flatMap((i) => (i.kind === "tools" ? i.steps : []))} labels={labels} />
        </div>
      )}
    </div>
  );
}
