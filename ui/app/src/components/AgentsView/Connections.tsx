import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Database, Pencil, Plus, Snowflake, Trash2, Unlink } from "lucide-react";
import { btn, cn, errorBanner, muted } from "@shared/cn";
import {
  createTool,
  deleteTool,
  fetchToolUsers,
  fetchAgentTools,
  fetchTools,
  postgresIn,
  postgresOf,
  setAgentTools,
  snowflakeIn,
  snowflakeOf,
  updateTool,
  type CloudPostgres,
  type CloudPostgresIn,
  type CloudSnowflake,
  type CloudSnowflakeIn,
  type ConnectionKind,
  type Tool,
  type ToolIn,
  type ToolUser,
} from "../../api";
import { CloudPostgresDialog } from "./CloudPostgres";
import { MAX_CLOUD_POSTGRES } from "./cloudPostgresCheck";
import { CloudSnowflakeDialog } from "./CloudSnowflake";
import { MAX_CLOUD_SNOWFLAKE } from "./cloudSnowflakeCheck";
import { GRID, ToolRowFrame } from "./ToolCards";
import { dialogs } from "../common/confirm";

export const POSTGRES_LOOK = [Database, "text-sky-700 dark:text-sky-400"] as const;
export const SNOWFLAKE_LOOK = [Snowflake, "text-cyan-600 dark:text-cyan-400"] as const;
export const lookOfConnection = (kind: string) => (kind === "snowflake" ? SNOWFLAKE_LOOK : POSTGRES_LOOK);
const MOST: Record<ConnectionKind, number> = { postgres: MAX_CLOUD_POSTGRES, snowflake: MAX_CLOUD_SNOWFLAKE };
const ICON_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700";
const REMOVE_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-red-50 hover:text-red-600 dark:text-stone-400 dark:hover:bg-red-950 dark:hover:text-red-400";

/** A connection's one line: read or write, and where. */
export function connectionLine(t: (k: string) => string, x: Tool): string {
  const rw = t(x.config.changes === true ? "agents.tools.postgres.readWrite" : "agents.tools.postgres.readOnly");
  if (x.kind === "snowflake") {
    const c = snowflakeOf(x);
    return `${rw} · ${c.database} · ${c.account}`;
  }
  const c = postgresOf(x);
  return `${rw} · ${c.user}@${c.host}:${c.port}/${c.database}`;
}

/** Why a connection cannot be deleted: the SQL Query tools on it, and which agents have each. */
function InUseDialog({ name, tools, onClose }: { name: string; tools: ToolUser[]; onClose: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const heading = t("agents.connections.inUseTitle", { name });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={heading} className="flex max-h-[90vh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl dark:bg-stone-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className="text-sm">{t("agents.connections.inUse", { count: tools.length })}</p>
        <ul className="flex flex-col gap-2" data-track-private>
          {tools.map((x) => (
            <li key={x.id} className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="font-mono">{x.name}</span>
                {x.draft && <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 dark:bg-violet-900 dark:text-violet-100">{t("agents.connections.draft")}</span>}
              </div>
              <p className={cn(muted, "text-xs")}>
                {x.agents.length > 0
                  ? t("agents.connections.usedByAgents", { agents: x.agents.map((a) => a.label).join(", ") })
                  : t("agents.connections.usedByNone")}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <button type="button" className={btn} onClick={onClose}>
            {t("agents.connections.close")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * An agent's **database connections**, on its General tab (2026-11-17, the person's call): a
 * PostgreSQL or Snowflake connection is not a tool the AI sees — the agent reaches a database
 * only through the SQL Query tools written on it (Tools, Database). Each connection is one of
 * the person's tools (apps/cloud/user_tools.py), kept with an id: **made, changed, connected
 * and disconnected here at once**, as the Tools tab's are. Disconnecting leaves it in the
 * person's account, to connect again. **A connection is shared by every agent given it**, so it
 * can be deleted from any of them — unless a SQL Query tool uses it: then a dialog names those
 * tools and the agents that have them (Wysebee Cloud refuses too).
 */
export function Connections({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const [mine, setMine] = useState<Tool[] | null>(null);
  const [library, setLibrary] = useState<Tool[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: ConnectionKind; row?: Tool } | null>(null);
  // A connection asked to be deleted, and the SQL tools that keep it.
  const [blocked, setBlocked] = useState<{ name: string; tools: ToolUser[] } | null>(null);
  const load = useCallback(async () => {
    try {
      const [agent, all] = await Promise.all([fetchAgentTools(agentId), fetchTools()]);
      setMine(agent.tools.filter((x) => x.kind === "postgres" || x.kind === "snowflake"));
      setLibrary(all.tools.filter((x) => x.kind === "postgres" || x.kind === "snowflake"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [agentId]);
  useEffect(() => {
    void load();
  }, [load]);

  const held = mine ?? [];
  const ids = (k: ConnectionKind) => held.filter((x) => x.kind === k).map((x) => x.id);
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const connect = (x: Tool) => run(() => setAgentTools(agentId, x.kind, [...ids(x.kind as ConnectionKind), x.id]));
  const disconnect = async (x: Tool) => {
    if (!(await dialogs.confirm(t("agents.connections.confirmRemove", { name: x.name }), { action: "disconnect" }))) return;
    void run(() => setAgentTools(agentId, x.kind, ids(x.kind as ConnectionKind).filter((i) => i !== x.id)));
  };
  /** Deleted everywhere once asked — but never while a SQL Query tool uses it. */
  const remove = (x: Tool) =>
    void run(async () => {
      const { tools } = await fetchToolUsers(x.id);
      if (tools.length > 0) return setBlocked({ name: x.name, tools });
      if (await dialogs.confirm(t("agents.connections.confirmDelete", { name: x.name }), { action: "delete" })) await deleteTool(x.id);
    });
  const deleteButton = (x: Tool) => (
    <button type="button" className={REMOVE_BUTTON} onClick={() => remove(x)} aria-label={t("agents.connections.delete", { name: x.name })} title={t("agents.connections.delete", { name: x.name })}>
      <Trash2 size={15} aria-hidden />
    </button>
  );
  /** A dialog's save: changed in the person's tools, or made and connected to this agent. */
  const keep = async (kind: ConnectionKind, row: Tool | undefined, body: ToolIn): Promise<Tool> => {
    const saved = row ? await updateTool(row.id, body) : await createTool(body);
    if (!row) await setAgentTools(agentId, kind, [...ids(kind), saved.id]);
    await load();
    return saved;
  };
  const full = (k: ConnectionKind) => mine === null || ids(k).length >= MOST[k];
  /** The person's other connections' names, which the one being edited must not repeat. */
  const others = (k: ConnectionKind, row?: Tool) => library.filter((x) => x.kind === k && x.id !== row?.id).map((x) => x.name);
  const unconnected = library.filter((x) => !held.some((m) => m.id === x.id));

  const row = (x: Tool, actions: React.ReactNode) => {
    const look = lookOfConnection(x.kind);
    return <ToolRowFrame key={x.id} icon={look[0]} color={look[1]} title={x.name} short={connectionLine(t, x)} help={x.description || t(`agents.tools.${x.kind}.help`)} actions={actions} />;
  };

  return (
    <section aria-label={t("agents.connections.title")} className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-medium">{t("agents.connections.title")}</h2>
        <p className={cn(muted, "text-xs")}>{t("agents.connections.help")}</p>
      </div>
      {error && <div className={cn(errorBanner, "text-xs")}>{error}</div>}
      {mine !== null && mine.length === 0 && <p className={cn(muted, "text-sm")}>{t("agents.connections.none")}</p>}
      {mine !== null && mine.length > 0 && (
        <div className={GRID} data-track-private>
          {mine.map((x) =>
            row(
              x,
              canEdit && (
                <>
                  <button type="button" className={ICON_BUTTON} onClick={() => setEditing({ kind: x.kind as ConnectionKind, row: x })} aria-label={t("agents.connections.edit", { name: x.name })} title={t("agents.connections.edit", { name: x.name })}>
                    <Pencil size={15} aria-hidden />
                  </button>
                  <button type="button" className={ICON_BUTTON} onClick={() => disconnect(x)} aria-label={t("agents.connections.remove", { name: x.name })} title={t("agents.connections.remove", { name: x.name })}>
                    <Unlink size={15} aria-hidden />
                  </button>
                  {deleteButton(x)}
                </>
              ),
            ),
          )}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {(["postgres", "snowflake"] as const).map((k) => {
            const Icon = lookOfConnection(k)[0];
            return (
              <button key={k} type="button" className={cn(btn, "flex items-center gap-1.5")} onClick={() => setEditing({ kind: k })} disabled={full(k)} data-track={`Add connection ${k}`}>
                <Icon size={15} aria-hidden />
                {t("agents.connections.add", { kind: t(`agents.tools.${k}.title`) })}
              </button>
            );
          })}
        </div>
      )}
      {canEdit && unconnected.length > 0 && (
        <div className="mt-2">
          <h3 className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">{t("agents.connections.yours")}</h3>
          <div className={GRID} data-track-private>
            {unconnected.map((x) => {
              const label = t("agents.connections.connect", { name: x.name });
              return row(
                x,
                <>
                  {deleteButton(x)}
                  <button type="button" className="shrink-0 rounded-lg p-1.5 text-stone-700 hover:bg-stone-200 disabled:opacity-40 dark:text-stone-200 dark:hover:bg-stone-700" onClick={() => void connect(x)} disabled={full(x.kind as ConnectionKind)} aria-label={label} title={label}>
                    <Plus size={20} strokeWidth={1.75} aria-hidden />
                  </button>
                </>,
              );
            })}
          </div>
        </div>
      )}
      {blocked && <InUseDialog name={blocked.name} tools={blocked.tools} onClose={() => setBlocked(null)} />}
      {editing?.kind === "postgres" && (
        <CloudPostgresDialog
          initial={editing.row ? postgresOf(editing.row) : undefined}
          others={others("postgres", editing.row)}
          onSave={async (name: string, c: CloudPostgresIn): Promise<CloudPostgres> => postgresOf(await keep("postgres", editing.row, postgresIn(name, c)))}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
      {editing?.kind === "snowflake" && (
        <CloudSnowflakeDialog
          initial={editing.row ? snowflakeOf(editing.row) : undefined}
          others={others("snowflake", editing.row)}
          onSave={async (name: string, c: CloudSnowflakeIn): Promise<CloudSnowflake> => snowflakeOf(await keep("snowflake", editing.row, snowflakeIn(name, c)))}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </section>
  );
}
