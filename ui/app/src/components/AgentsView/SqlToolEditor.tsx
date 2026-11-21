import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Database, Plus, X } from "lucide-react";
import { btn, btnPrimary, cn, errorBanner, inputBase, muted } from "@shared/cn";
import { Hint } from "../common/Hint";
import { SQL_PARAM_TYPES, sqlToolIn, validateSql, type SqlParam, type SqlParamType, type SqlTool, type Tool } from "../../api";

/** A SQL tool's name: letters, digits, _ and -, starting and ending with a letter, digit or _
 * (apps/cloud/agent_chat/sql_tools.py `NAME`). */
export const SQL_NAME = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9_])?$/;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const LABEL = "mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400";
const HELP = cn(muted, "mt-1 text-xs");
const LINK = "flex items-center gap-1 text-sm font-medium text-primary-700 hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100";

const blank = (): SqlParam => ({ name: "", type: "string", description: "", required: false, default: "", optional: false });

/** Which parts a proposed version changes, by i18n key under `agents.tools.sql.parts`. */
export function changedParts(now: SqlTool, next: SqlTool): string[] {
  const parts: [string, unknown, unknown][] = [
    ["name", now.name, next.name],
    ["description", now.description, next.description],
    ["connection", now.connectionId, next.connectionId],
    ["params", JSON.stringify(now.params), JSON.stringify(next.params)],
    ["sql", now.sql, next.sql],
  ];
  return parts.filter(([, a, b]) => a !== b).map(([k]) => k);
}

/** What is wrong with the tool as typed (an i18n key), or null: what the server checks too. */
export function sqlToolProblemOf(s: SqlTool, others: string[]): string | null {
  const name = s.name.trim();
  if (!SQL_NAME.test(name)) return "agents.tools.sql.badName";
  if (others.includes(name)) return "agents.tools.sql.taken";
  if (!s.description.trim()) return "agents.tools.sql.needDescription";
  if (!s.connectionId) return "agents.tools.sql.needConnection";
  const names = s.params.map((p) => p.name.trim());
  if (names.some((n) => !PARAM_NAME.test(n) || n === "database")) return "agents.tools.sql.badParam";
  if (new Set(names).size !== names.length) return "agents.tools.sql.twoParams";
  if (!s.sql.trim()) return "agents.tools.sql.needSql";
  return null;
}

/**
 * A SQL Query tool's page (2026-11-17): its id (the tool's for good, chosen here before it is
 * made, so it can be shown), its name — what the AI calls it, safe to rename — what it
 * computes, the database connection it queries (one of the agent's), its **input parameters**
 * and its **SQL template**. `{param}` is a parameter, bound — never written into the SQL —
 * `{database}` the connection's database, and `[[ … ]]` a part left out when a parameter that
 * only filters when set has no value. **Validate** asks the database whether it accepts the
 * statement, without running it. With no connection yet, it asks for one first (`onConnect`
 * opens the agent's General tab).
 */
export function SqlToolEditor({
  initial,
  connections,
  others,
  onSave,
  onDiscardChange,
  onBack,
  onConnect,
}: {
  initial?: SqlTool;
  /** The connections it may query: the agent's. */
  connections: Tool[];
  /** The person's other SQL tools' names, which this one must not repeat. */
  others: string[];
  /** Keep it: made (`fresh`) or changed; a refusal is said here. */
  onSave: (tool: SqlTool, fresh: boolean) => Promise<void>;
  /** A change the person's AI app proposed, thrown away: the tool kept as it is. */
  onDiscardChange?: (tool: SqlTool) => Promise<void>;
  onBack: () => void;
  onConnect: () => void;
}) {
  const { t } = useTranslation();
  // A proposed change opens on the tool as it would be.
  const [tool, setTool] = useState<SqlTool>(() => (initial?.pending ? { ...initial.pending, id: initial.id } : initial) ?? { id: crypto.randomUUID(), name: "", description: "", connectionId: connections.length === 1 ? connections[0].id : "", params: [], sql: "" });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "validate" | null>(null);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (patch: Partial<SqlTool>) => {
    setTool((s) => ({ ...s, ...patch }));
    setChecked(null);
  };
  const setParam = (i: number, patch: Partial<SqlParam>) => set({ params: tool.params.map((p, n) => (n === i ? { ...p, ...patch } : p)) });
  const fresh = !initial;
  // A draft from the person's AI app: created (no longer a draft) by this page's save.
  const draft = initial?.draft === true;
  // A change the person's AI app proposed to this (live) tool: applied by this page's save.
  const change = !draft && initial?.pending ? initial : null;
  const missing = !!initial && !connections.some((c) => c.id === initial.connectionId);

  const save = async () => {
    // Its connection must be one of the agent's now.
    const wrong = sqlToolProblemOf(tool, others) ?? (connections.some((c) => c.id === tool.connectionId) ? null : "agents.tools.sql.needConnection");
    setProblem(wrong && t(wrong));
    if (wrong) return;
    setBusy("save");
    try {
      await onSave(tool, fresh);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const validate = async () => {
    setBusy("validate");
    setChecked(null);
    try {
      const r = await validateSql(sqlToolIn(tool));
      setChecked(r.ok ? { ok: true, text: t("agents.tools.sql.valid") } : { ok: false, text: r.error });
    } catch (e) {
      setChecked({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <div className="flex items-center gap-3">
      <button type="button" className="flex items-center gap-1.5 rounded-full border border-primary-400 px-3 py-1 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:border-primary-600 dark:text-primary-300 dark:hover:bg-primary-950" onClick={onBack} data-track="SQL tool back">
        <ArrowLeft size={16} aria-hidden />
        {t("agents.tools.sql.back")}
      </button>
      <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{fresh ? t("agents.tools.sql.newTitle") : draft ? t("agents.tools.sql.reviewTitle", { name: initial.name }) : change ? t("agents.tools.sql.changeTitle", { name: initial.name }) : t("agents.tools.sql.editTitle", { name: initial.name })}</h2>
      {change && onDiscardChange && (
        <button type="button" className={btn} onClick={() => void onDiscardChange(change).catch((e: Error) => setProblem(e.message))} disabled={busy !== null} data-track="Discard SQL tool change">
          {t("agents.tools.sql.discardChange")}
        </button>
      )}
      {connections.length > 0 && (
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={busy !== null} data-track={fresh ? "Create SQL tool" : "Save SQL tool"}>
          {busy === "save" ? t("agents.tools.sql.saving") : fresh || draft ? t("agents.tools.sql.create") : change ? t("agents.tools.sql.applyChange") : t("agents.tools.sql.save")}
        </button>
      )}
    </div>
  );

  // No database connected yet: one first, on the agent's General tab.
  if (connections.length === 0 && fresh)
    return (
      <div className="flex flex-col gap-4">
        {header}
        <div role="note" className="flex flex-col items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-100">
            <Database size={18} aria-hidden />
            {t("agents.tools.sql.noConnectionTitle")}
          </div>
          <p className="text-sm text-amber-900 dark:text-amber-100">{t("agents.tools.sql.noConnection")}</p>
          <button type="button" className={btnPrimary} onClick={onConnect} data-track="SQL tool connect first">
            {t("agents.tools.sql.connectFirst")}
          </button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-5" data-track-private>
      {header}
      {draft && (
        <p role="note" className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
          {t("agents.tools.sql.draftNote")}
        </p>
      )}
      {change && (
        <div role="note" className="flex flex-col gap-2 rounded-xl border border-violet-300 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
          <p>{t("agents.tools.sql.changeNote")}</p>
          <p className="text-xs">{t("agents.tools.sql.changed", { what: changedParts(change, change.pending!).map((k) => t(`agents.tools.sql.parts.${k}`)).join(", ") || t("agents.tools.sql.parts.nothing") })}</p>
          {change.sql !== change.pending!.sql && (
            <div>
              <p className="mb-1 text-xs">{t("agents.tools.sql.sqlNow")}</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-violet-200 bg-white p-2 font-mono text-xs text-stone-800 dark:border-violet-900 dark:bg-stone-900 dark:text-stone-200">{change.sql}</pre>
            </div>
          )}
        </div>
      )}
      {problem && <div className={errorBanner}>{problem}</div>}
      <div>
        <label className={LABEL} htmlFor="sql-id">
          {t("agents.tools.sql.id")}
        </label>
        <input id="sql-id" className={cn(inputBase, "font-mono text-stone-500")} value={tool.id} readOnly />
        <p className={HELP}>{t("agents.tools.sql.idHelp")}</p>
      </div>
      <div>
        <label className={LABEL} htmlFor="sql-name">
          {t("agents.tools.sql.name")}
        </label>
        <input id="sql-name" className={inputBase} value={tool.name} placeholder="calc_my_metric" onChange={(e) => set({ name: e.target.value })} autoFocus={fresh} />
        <p className={HELP}>{t("agents.tools.sql.nameHelp")}</p>
      </div>
      <div>
        <label className={LABEL} htmlFor="sql-description">
          {t("agents.tools.sql.description")}
        </label>
        <textarea id="sql-description" className={cn(inputBase, "min-h-20")} rows={3} value={tool.description} placeholder={t("agents.tools.sql.descriptionPlaceholder")} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div>
        <label className={LABEL} htmlFor="sql-connection">
          {t("agents.tools.sql.connection")}
        </label>
        <select id="sql-connection" className={inputBase} value={tool.connectionId} onChange={(e) => set({ connectionId: e.target.value })}>
          {(!tool.connectionId || missing) && <option value={tool.connectionId}>{missing ? t("agents.tools.sql.connectionGone") : t("agents.tools.sql.pickConnection")}</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {`${c.name} · ${t(`agents.tools.${c.kind}.title`)}`}
            </option>
          ))}
        </select>
        <p className={HELP}>
          {t("agents.tools.sql.connectionHelp")}{" "}
          <button type="button" className="underline underline-offset-2 hover:text-stone-800 dark:hover:text-stone-100" onClick={onConnect}>
            {t("agents.tools.sql.manageConnections")}
          </button>
        </p>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className={cn(LABEL, "mb-0")}>{t("agents.tools.sql.params")}</span>
          <button type="button" className={LINK} onClick={() => set({ params: [...tool.params, blank()] })} data-track="SQL tool add parameter">
            <Plus size={16} aria-hidden />
            {t("agents.tools.sql.addParam")}
          </button>
        </div>
        {tool.params.length === 0 ? (
          <p className={cn(muted, "text-sm")}>{t("agents.tools.sql.noParams")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {tool.params.map((p, i) => (
              <li key={i} className="flex flex-col gap-2" aria-label={t("agents.tools.sql.param", { n: i + 1 })}>
                <div className="flex flex-wrap items-center gap-2">
                  <input className={cn(inputBase, "min-w-40 flex-[3] font-mono")} aria-label={t("agents.tools.sql.paramName")} placeholder="param_name" value={p.name} onChange={(e) => setParam(i, { name: e.target.value })} />
                  <select className={cn(inputBase, "w-36 flex-1")} aria-label={t("agents.tools.sql.paramType")} value={p.type} onChange={(e) => setParam(i, { type: e.target.value as SqlParamType })}>
                    {SQL_PARAM_TYPES.map((k) => (
                      <option key={k} value={k}>
                        {t(`agents.tools.sql.types.${k}`)}
                      </option>
                    ))}
                  </select>
                  <input className={cn(inputBase, "w-32 flex-1")} aria-label={t("agents.tools.sql.paramDefault")} placeholder={t("agents.tools.sql.paramDefault")} value={p.default} onChange={(e) => setParam(i, { default: e.target.value })} />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={p.required && !p.optional} disabled={p.optional} onChange={(e) => setParam(i, { required: e.target.checked })} />
                    {t("agents.tools.sql.required")}
                  </label>
                  <button type="button" className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:hover:bg-stone-700" onClick={() => set({ params: tool.params.filter((_, n) => n !== i) })} aria-label={t("agents.tools.sql.removeParam", { name: p.name || i + 1 })} title={t("agents.tools.sql.removeParam", { name: p.name || i + 1 })}>
                    <X size={18} aria-hidden />
                  </button>
                </div>
                <div className="flex items-center gap-2 pl-3">
                  <input className={cn(inputBase, "flex-1 text-sm")} aria-label={t("agents.tools.sql.paramDescription")} placeholder={t("agents.tools.sql.paramDescriptionPlaceholder")} value={p.description} onChange={(e) => setParam(i, { description: e.target.value })} />
                  <Hint text={t("agents.tools.sql.paramDescriptionHelp")} />
                </div>
                <label className="flex items-center gap-2 pl-3 text-sm">
                  <input type="checkbox" checked={p.optional} onChange={(e) => setParam(i, { optional: e.target.checked, ...(e.target.checked ? { required: false } : {}) })} />
                  {t("agents.tools.sql.optional")}
                  <Hint text={t("agents.tools.sql.optionalHelp", { example: `{${p.name || "param_name"}}` })} />
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={cn(LABEL, "mb-0")} htmlFor="sql-template">
            {t("agents.tools.sql.template")}
          </label>
          <button type="button" className={cn(btn, "rounded-full")} onClick={() => void validate()} disabled={busy !== null || !tool.connectionId || !tool.sql.trim()} data-track="SQL tool validate">
            {busy === "validate" ? t("agents.tools.sql.validating") : t("agents.tools.sql.validate")}
          </button>
        </div>
        <textarea
          id="sql-template"
          className={cn(inputBase, "min-h-64 font-mono text-sm")}
          rows={12}
          spellCheck={false}
          value={tool.sql}
          placeholder="SELECT … FROM {database}.REPORTING_SECURE.X WHERE BUILDING_ID = {building_id}"
          onChange={(e) => set({ sql: e.target.value })}
        />
        <p className={HELP}>{t("agents.tools.sql.templateHelp")}</p>
        {checked && (
          <p role="status" className={cn("mt-2 text-sm", checked.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
            {checked.text}
          </p>
        )}
      </div>
    </div>
  );
}
