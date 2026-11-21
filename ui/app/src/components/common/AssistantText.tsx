import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import platform from "../../platform";
import { cn } from "@shared/cn";
import { ChatMarkdown, DOCUMENT_CLASSES, MARKDOWN_CLASSES } from "@shared/ChatMarkdown";
import { ChartView, type ChartSource } from "@shared/ChartView";
import { EmailList } from "@shared/EmailList";
import { CalendarView } from "@shared/CalendarView";
import { type ToolLabels } from "@shared/ToolCalls";

// d3 for a chart's frame, inlined into it (chartRuntime.ts): fetched on the first chart,
// not with the page. `?raw` of the UMD build, by path — d3's package exports name no
// such file.
const CHART_SOURCE: ChartSource = {
  kind: "srcdoc",
  d3: () => import("../../../../node_modules/d3/dist/d3.min.js?raw").then((m) => m.default),
};

/** Markdown with charts, email lists and calendars. Links leave the app rather than navigating its page.
 * Workspaces' Preview and a task's run use it. */
export function AssistantText({
  text,
  document = false,
}: {
  text: string;
  /** A page rather than an answer (Workspaces' Preview): roomier, with a heading scale. */
  document?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const link = (href: string | undefined, children: ReactNode) => (
    <a
      href={href}
      className="text-primary-700 underline dark:text-primary-300"
      onClick={(e) => {
        e.preventDefault();
        if (!href || !/^https?:\/\//i.test(href)) return;
        void platform.openExternal(href).then((opened) => {
          if (!opened) window.open(href, "_blank", "noopener");
        });
      }}
    >
      {children}
    </a>
  );
  return (
    <div
      className={cn(
        document
          ? "rounded-lg border border-stone-200 bg-white px-8 py-7 text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          : "rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-800",
        document ? DOCUMENT_CLASSES : MARKDOWN_CLASSES,
      )}
    >
      <ChatMarkdown
        text={text}
        link={link}
        blocks={{
          d3: (code) => (
            <ChartView
              code={code}
              source={CHART_SOURCE}
              labels={{
                title: t("agents.chat.chartTitle"),
                loading: t("agents.chat.chartLoading"),
                failed: (error) => t("agents.chat.chartFailed", { error }),
                showCode: t("agents.chat.chartCode"),
              }}
            />
          ),
          "email-list": (json) => (
            <EmailList
              text={json}
              link={link}
              // An email's own text: markdown, but nothing drawn from it.
              body={(body) => <ChatMarkdown text={body} link={link} />}
              labels={{
                count: (count) => t("agents.chat.emailCount", { count }),
                openOriginal: t("agents.chat.emailOpen"),
                noSubject: t("agents.chat.emailNoSubject"),
                noBody: t("agents.chat.emailNoBody"),
                unread: t("agents.chat.emailUnread"),
                invalid: (error) => t("agents.chat.emailInvalid", { error }),
              }}
            />
          ),
          calendar: (json) => (
            <CalendarView
              text={json}
              link={link}
              labels={{
                locale: i18n.resolvedLanguage || i18n.language || "en",
                allDay: t("agents.chat.calendarAllDay"),
                openCalendar: t("agents.chat.calendarOpen"),
                noEvents: t("agents.chat.calendarEmpty"),
                noTitle: t("agents.chat.calendarNoTitle"),
                invalid: (error) => t("agents.chat.calendarInvalid", { error }),
              }}
            />
          ),
        }}
      />
    </div>
  );
}

/** The tool-call strings, from this app's translations, for `@shared/ToolCalls`. */
export function useToolLabels(): ToolLabels {
  const { t } = useTranslation();
  return {
    used: (count) => t("agents.chat.toolsUsed", { count }),
    failed: (count) => t("agents.chat.toolsFailed", { count }),
    error: t("agents.chat.toolFailed"),
    notRun: t("agents.chat.toolNotRun"),
    noOutput: t("agents.chat.toolNoOutput"),
    imageAlt: (tool) => t("agents.chat.imageAlt", { tool }),
    imageEnlarge: t("agents.chat.imageEnlarge"),
    imageShrink: t("agents.chat.imageShrink"),
    copy: t("agents.chat.toolOutputCopy"),
    copied: t("agents.chat.toolOutputCopied"),
  };
}
