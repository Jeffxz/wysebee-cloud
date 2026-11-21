import { useEffect, useState } from "react";
import { INSTRUCTIONS_FIELD } from "./shared";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, Eye, Sparkles, X } from "lucide-react";
import { btn, btnPrimary, cn, muted } from "@shared/cn";
import { SITE_KINDS, type SkillRequest, type Tool } from "../../api";
import { programOf } from "./ToolCards";

/** The agent's settings field holding switches the person's AI app asked to turn on. */
export const REQUESTS_FIELD = "switch_requests";
/** A switch the person's AI app asked for, and why. */
export interface SwitchRequest {
  field: string;
  reason: string;
}

const SITE: ReadonlySet<string> = new Set<string>(SITE_KINDS);

export function requestsOf(config: Record<string, unknown>): SwitchRequest[] {
  const raw = config[REQUESTS_FIELD];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>).map(([field, v]) => ({
    field,
    reason: v && typeof v === "object" && typeof (v as { reason?: unknown }).reason === "string" ? (v as { reason: string }).reason : "",
  }));
}

/** The agent's settings field holding a new Instruction the person's AI app proposed. */
export const INSTRUCTION_FIELD = "instruction_proposal";
/** A proposed Instruction, why, and the agent's own now. */
export interface InstructionProposal {
  text: string;
  reason: string;
  current: string;
}

export function instructionOf(config: Record<string, unknown>): InstructionProposal | null {
  const raw = config[INSTRUCTION_FIELD] as { text?: unknown; reason?: unknown } | undefined;
  if (!raw || typeof raw !== "object" || typeof raw.text !== "string") return null;
  const current = typeof config[INSTRUCTIONS_FIELD] === "string" ? (config[INSTRUCTIONS_FIELD] as string) : "";
  return { text: raw.text, reason: typeof raw.reason === "string" ? raw.reason : "", current };
}

/** A tool drafted by the person's AI app, not created yet. */
export const isDraft = (t: Tool) => t.config.draft === true;
/** A live tool with a change the person's AI app proposed. */
export const hasPending = (t: Tool) => !!t.config.pending && typeof t.config.pending === "object";

const CARD = "flex flex-col gap-1.5 rounded-lg border border-violet-200 bg-white px-3 py-2 dark:border-violet-900 dark:bg-stone-900";
const PRE = "max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-violet-200 bg-white p-2 font-mono text-xs dark:border-violet-900 dark:bg-stone-950";
const TAG = "rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 dark:bg-violet-900 dark:text-violet-100";

/**
 * What the person's AI app proposed for this agent (apps/cloud/tool_drafts.py — **AI apps
 * propose, the person approves**, docs/ai-apps-propose.md): drafted tools, changes to its SQL
 * tools and switches it asks to turn on. None is used until the person accepts it here: a
 * SQL tool or change is reviewed in its editor (`onReview`); a site link or program is created
 * as shown (`onCreate`); a switch is turned on with the settings' Save. Discarding a draft
 * deletes it; declining a request forgets it.
 *
 * **Out of the way of the Tools tab:** a small button with how many wait, beside the tab's
 * sections, opens them in a panel that slides in from the right (closed with ×, Escape or a
 * click beside it, and when none is left). Nothing shows when none waits.
 */
export function Proposals({
  drafts,
  changes,
  requests,
  skills,
  instruction,
  onReviewInstruction,
  onDiscardInstruction,
  onGiveSkill,
  onDeclineSkill,
  onReview,
  onCreate,
  onDiscard,
  onTurnOn,
  onDecline,
  switchText,
}: {
  drafts: Tool[];
  changes: Tool[];
  requests: SwitchRequest[];
  /** Skills the AI app asks to give this agent. */
  skills: SkillRequest[];
  /** A new Instruction the AI app proposed: reviewed on the Instruction tab, or discarded. */
  instruction: InstructionProposal | null;
  onReviewInstruction: () => void;
  onDiscardInstruction: () => void;
  onGiveSkill: (skillId: string) => void;
  onDeclineSkill: (skillId: string) => void;
  onReview: (tool: Tool) => void;
  onCreate: (tool: Tool) => void;
  onDiscard: (tool: Tool) => void;
  onTurnOn: (field: string) => void;
  onDecline: (field: string) => void;
  /** A switch's name and what it allows. */
  switchText: (field: string) => [title: string, help: string];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [shownInstruction, setShownInstruction] = useState(false);
  const count = drafts.length + changes.length + requests.length + skills.length + (instruction ? 1 : 0);
  useEffect(() => {
    if (count === 0) setOpen(false);
  }, [count]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (count === 0) return null;
  const title = t("agents.tools.proposals.title");
  // Reviewed in the SQL editor, which takes the page: the panel goes.
  const review = (x: Tool) => {
    setOpen(false);
    onReview(x);
  };
  const what = (x: Tool) =>
    x.kind === "sql" ? t("agents.tools.proposals.kind.sql") : x.kind === "program" ? t("agents.tools.proposals.kind.program") : t("agents.tools.proposals.kind.site", { kind: t(`agents.tools.${x.kind}.title`) });
  const detail = (x: Tool) => {
    if (SITE.has(x.kind)) return <code className="block truncate font-mono text-xs">{x.name}</code>;
    if (x.kind !== "program") return null;
    const p = programOf(x);
    return <code className="block truncate font-mono text-xs">{[p.command, ...p.args.map((a) => ("param" in a ? `<${a.param}>` : a.value))].join(" ")}</code>;
  };
  const list = (
      <ul className="flex flex-col gap-2">
        {drafts.map((x) => (
          <li key={x.id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[10rem] flex-1 truncate text-sm font-medium">{x.kind === "sql" || x.kind === "program" ? x.name : x.description}</span>
              <span className={TAG}>{what(x)}</span>
              {x.kind === "sql" ? (
                <button type="button" className={cn(btnPrimary, "text-xs")} onClick={() => review(x)} aria-label={t("agents.tools.proposals.reviewOne", { name: x.name })}>
                  <Eye size={13} aria-hidden /> {t("agents.tools.proposals.review")}
                </button>
              ) : (
                <button type="button" className={cn(btnPrimary, "text-xs")} onClick={() => onCreate(x)} aria-label={t("agents.tools.proposals.createOne", { name: x.name })}>
                  <Check size={13} aria-hidden /> {t("agents.tools.proposals.create")}
                </button>
              )}
              <button type="button" className={cn(btn, "text-xs")} onClick={() => onDiscard(x)} aria-label={t("agents.tools.proposals.discardOne", { name: x.name })}>
                <X size={13} aria-hidden /> {t("agents.tools.proposals.discard")}
              </button>
            </div>
            {x.kind !== "sql" && x.kind !== "program" ? null : <p className={cn(muted, "text-xs")}>{x.description}</p>}
            {detail(x)}
            {x.kind === "program" && <p className={cn(muted, "text-[11px]")}>{t("agents.tools.proposals.programNote")}</p>}
          </li>
        ))}
        {changes.map((x) => (
          <li key={x.id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[10rem] flex-1 truncate text-sm font-medium">{x.name}</span>
              <span className={TAG}>{t("agents.tools.proposals.kind.change")}</span>
              <button type="button" className={cn(btnPrimary, "text-xs")} onClick={() => review(x)} aria-label={t("agents.tools.proposals.reviewOne", { name: x.name })}>
                <Eye size={13} aria-hidden /> {t("agents.tools.proposals.review")}
              </button>
            </div>
            <p className={cn(muted, "text-xs")}>{t("agents.tools.proposals.changeNote")}</p>
          </li>
        ))}
        {instruction && (
          <li className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[10rem] flex-1 truncate text-sm font-medium">{t("agents.tools.proposals.instructionTitle")}</span>
              <span className={TAG}>{t("agents.tools.proposals.kind.instruction")}</span>
              <button type="button" className={cn(btn, "text-xs")} onClick={() => setShownInstruction((v) => !v)} aria-expanded={shownInstruction}>
                <Eye size={13} aria-hidden /> {t(shownInstruction ? "agents.tools.proposals.hide" : "agents.tools.proposals.view")}
              </button>
              <button
                type="button"
                className={cn(btnPrimary, "text-xs")}
                onClick={() => {
                  setOpen(false);
                  onReviewInstruction();
                }}
                aria-label={t("agents.tools.proposals.reviewOne", { name: t("agents.tools.proposals.instructionTitle") })}
              >
                <Check size={13} aria-hidden /> {t("agents.tools.proposals.review")}
              </button>
              <button type="button" className={cn(btn, "text-xs")} onClick={onDiscardInstruction} aria-label={t("agents.tools.proposals.discardOne", { name: t("agents.tools.proposals.instructionTitle") })}>
                <X size={13} aria-hidden /> {t("agents.tools.proposals.discard")}
              </button>
            </div>
            {instruction.reason && <p className="text-xs">{t("agents.tools.proposals.reason", { reason: instruction.reason })}</p>}
            <p className={cn(muted, "text-[11px]")}>{t("agents.tools.proposals.instructionNote")}</p>
            {shownInstruction && (
              <div className="flex flex-col gap-2">
                <div>
                  <p className={cn(muted, "mb-1 text-xs")}>{t("agents.tools.proposals.now")}</p>
                  <pre className={PRE}>{instruction.current || t("agents.tools.proposals.none")}</pre>
                </div>
                <div>
                  <p className={cn(muted, "mb-1 text-xs")}>{t("agents.tools.proposals.proposed")}</p>
                  <pre className={PRE}>{instruction.text}</pre>
                </div>
              </div>
            )}
          </li>
        )}
        {skills.map((k) => (
          <li key={k.skill_id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[10rem] flex-1 truncate text-sm font-medium">{k.name}</span>
              <span className={TAG}>{t("agents.tools.proposals.kind.skill")}</span>
              <button type="button" className={cn(btnPrimary, "text-xs")} onClick={() => onGiveSkill(k.skill_id)} aria-label={t("agents.tools.proposals.giveOne", { name: k.name })}>
                <Check size={13} aria-hidden /> {t("agents.tools.proposals.give")}
              </button>
              <button type="button" className={cn(btn, "text-xs")} onClick={() => onDeclineSkill(k.skill_id)} aria-label={t("agents.tools.proposals.declineOne", { name: k.name })}>
                <X size={13} aria-hidden /> {t("agents.tools.proposals.decline")}
              </button>
            </div>
            <p className={cn(muted, "text-xs")}>{k.description}</p>
            {k.reason && <p className="text-xs">{t("agents.tools.proposals.reason", { reason: k.reason })}</p>}
            <a className="text-xs text-violet-700 underline dark:text-violet-300" href={`#/skills/${encodeURIComponent(k.skill_id)}`}>
              {t("agents.tools.proposals.skillFiles")}
            </a>
          </li>
        ))}
        {requests.map((r) => {
          const [title, help] = switchText(r.field);
          return (
            <li key={r.field} className={cn(CARD, "border-amber-300 dark:border-amber-800")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-[10rem] flex-1 truncate text-sm font-medium">{title}</span>
                <span className={TAG}>{t("agents.tools.proposals.kind.switch")}</span>
                <button type="button" className={cn(btnPrimary, "text-xs")} onClick={() => onTurnOn(r.field)} aria-label={t("agents.tools.proposals.turnOnOne", { name: title })}>
                  <Check size={13} aria-hidden /> {t("agents.tools.proposals.turnOn")}
                </button>
                <button type="button" className={cn(btn, "text-xs")} onClick={() => onDecline(r.field)} aria-label={t("agents.tools.proposals.declineOne", { name: title })}>
                  <X size={13} aria-hidden /> {t("agents.tools.proposals.decline")}
                </button>
              </div>
              {r.reason && <p className="text-xs">{t("agents.tools.proposals.reason", { reason: r.reason })}</p>}
              <p className="flex items-start gap-1.5 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
                <span>{t("agents.tools.proposals.switchWarn", { help })}</span>
              </p>
            </li>
          );
        })}
      </ul>
  );
  return (
    <>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-900 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/60"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-track="Open proposals"
      >
        <Sparkles size={15} className="text-violet-700 dark:text-violet-300" aria-hidden />
        {t("agents.tools.proposals.open", { count })}
        <span className="rounded-full bg-violet-600 px-1.5 text-[11px] leading-4 text-white">{count}</span>
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
            <style>{"@keyframes wysebee-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}"}</style>
            <section
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="flex h-full w-[28rem] max-w-full flex-col gap-3 overflow-y-auto border-l border-violet-300 bg-violet-50 p-4 shadow-xl dark:border-violet-800 dark:bg-stone-900"
              style={{ animation: "wysebee-slide-in 160ms ease-out" }}
              onClick={(e) => e.stopPropagation()}
              data-track-private
            >
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-violet-700 dark:text-violet-300" aria-hidden />
                <h3 className="min-w-0 flex-1 text-sm font-semibold text-violet-900 dark:text-violet-100">{title}</h3>
                <button type="button" className="rounded p-1 text-stone-500 hover:bg-violet-100 hover:text-stone-800 dark:hover:bg-violet-900" onClick={() => setOpen(false)} aria-label={t("agents.tools.proposals.close")} title={t("agents.tools.proposals.close")}>
                  <X size={16} aria-hidden />
                </button>
              </div>
              <p className="text-xs text-violet-900 dark:text-violet-100">{t("agents.tools.proposals.note")}</p>
              {list}
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
