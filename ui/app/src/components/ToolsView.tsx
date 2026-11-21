import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Laptop, Plus } from "lucide-react";
import { cn, errorBanner, loading, muted } from "@shared/cn";
import { createTool, fetchAgentDetail, fetchAgentTools, fetchTools, isConnection, saveAgentConfig, setAgentTools, SITE_KINDS, sqlToolIn, type SiteKind, type SiteLink, type SqlTool, type Tool, type ToolKind } from "../api";
import { loadAgents, useAgents, type ChatAgent } from "../agents";
import { reasonOf } from "../workspaces";
import { AgentAvatar } from "./common/AgentAvatar";
import { LocalProgramDialog } from "./AgentsView/LocalProgramDialog";
import { SiteDialog } from "./AgentsView/SiteDialog";
import { SqlToolEditor } from "./AgentsView/SqlToolEditor";
import { ADD_BUTTON, BROWSER_LOOK, DEVTOOLS_LOOK, GRID, LIBRARY_TABS, programOf, TAB_TOOLS, TEMPLATE_LOOK, ToolRowFrame, type LibraryTab } from "./AgentsView/ToolCards";
import { listedMay, listing } from "./AgentsView/toolKinds";
import { useAgentTypes } from "../agentTypes";
import type { AgentType } from "../api";
import { giveTool, siteToolIds } from "./AgentsView/toolSaves";

/** A template that makes one of the person's tools (Local Folder is set up on the Mac). */
type Making = "local" | "sql" | SiteKind;
/** A template's dialog, open for the agent picked. */
interface Open {
  key: Making;
  agent: ChatAgent;
  /** A site tool's links the agent has now: its dialog edits them. */
  links: SiteLink[];
  /** A SQL tool's: the agent's database connections, which it may query. */
  connections: Tool[];
}

/** A tool's tool kind (Wysebee Cloud's agent types list them): a program is `local`. */
export const keyOf = (kind: ToolKind) => (kind === "program" ? "local" : kind);
const SITE_KEYS: ReadonlySet<string> = new Set<string>(SITE_KINDS);
const MENU_ITEM = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-stone-700";

/** The +: a menu of the person's agents to give a tool to. An agent whose kind may not have it
 * (toolKinds.ts, as Wysebee Cloud's agent types say; none fits until they are read), or that
 * has it already (`has`, asked when the menu opens), is greyed with why. */
function AgentPicker({ title, toolKey, has, onPick }: { title: string; toolKey: string; has?: (agent: ChatAgent) => Promise<boolean>; onPick: (agent: ChatAgent) => void }) {
  const { t } = useTranslation();
  const agents = useAgents().items ?? [];
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const types = useAgentTypes();
  const fits = (a: ChatAgent) => types !== null && listedMay(a, toolKey, types);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    // A click as well as a press: what a script clicks (the Wysebee Agent extension) fires no
    // mousedown, and another menu's + must close this one.
    document.addEventListener("mousedown", close);
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("click", close);
    };
  }, [open]);
  const toggle = () => {
    if (!open && has) {
      setHeld(new Set());
      for (const a of agents.filter(fits))
        has(a).then(
          (yes) => yes && setHeld((s) => new Set(s).add(a.id)),
          () => {},
        );
    }
    setOpen(!open);
  };
  const why = (a: ChatAgent) => (!fits(a) ? (types ? whoMay(toolKey, types, t, "only") : t("tools.typesLoading")) : held.has(a.id) ? t("tools.has") : null);
  const label = t("tools.addTo", { name: title });
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" className={ADD_BUTTON} onClick={toggle} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} data-track={`Tools page add ${toolKey}`}>
        <Plus size={22} strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          data-track-private
        >
          <p className={cn(muted, "px-2 py-1 text-xs")}>{t("tools.addToHeading")}</p>
          {agents.length === 0 && <p className={cn(muted, "px-2 py-1.5 text-sm")}>{t("tools.noAgents")}</p>}
          {agents.map((a) => {
            const reason = why(a);
            return (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                className={MENU_ITEM}
                disabled={reason !== null}
                onClick={() => {
                  setOpen(false);
                  onPick(a);
                }}
              >
                <AgentAvatar avatar={a.avatar} label={a.label} size={20} />
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {reason && <span className={cn(muted, "shrink-0 text-[11px]")}>{reason}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The Tools page (2026-11-15), below Skills on the rail: the Tool library's kinds of tool — in
 * its tabs, Local File & Folder, Website and Database (ToolCards.tsx) — then the person's own
 * tools of each (apps/cloud/user_tools.py), on the same cards as an agent's Tools tab. A tool
 * only some kinds of agent may have says which. **Each card's + picks one of the person's
 * agents and gives it the tool**, with the calls the Tools tab makes: one of their tools is
 * given as it is; a template's dialog makes the tool first (a site tool's dialog edits the
 * links that agent has); Browser access and the web development tools are set in the agent's
 * settings. A Mac agent's folders are picked on the Mac, so Local Folder has no +.
 *
 * Since 2026-11-20 the library's tabs are the menu beside the rail (ToolsNav): `tab` shows one
 * of them (`#/tools/<tab>`); none, **All tools** — every kind and every one of the person's.
 * `onLibrary` hears the person's tools each time they are read, for the menu's counts.
 */
export function ToolsView({ tab = null, onLibrary }: { tab?: LibraryTab | null; onLibrary?: (tools: Tool[]) => void } = {}) {
  // Which agents may have each tool: Wysebee Cloud's agent types (null until read).
  const types = useAgentTypes();
  const { t } = useTranslation();
  const agents = useAgents();
  useEffect(() => {
    if (agents.items === null) void loadAgents();
  }, [agents.items]);
  const [library, setLibrary] = useState<Tool[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState<Open | null>(null);
  const load = useCallback(
    () =>
      fetchTools().then(
        (r) => setLibrary(r.tools),
        (e) => setError(reasonOf(e)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (library) onLibrary?.(library);
  }, [library, onLibrary]);

  const gave = (tool: string, agent: ChatAgent) => toast.success(t("tools.added", { tool, agent: agent.label }));
  const attempt = async (work: () => Promise<unknown>) => {
    try {
      await work();
      setError(null);
    } catch (e) {
      setError(reasonOf(e));
    }
  };
  /** Made from a template's dialog, given to the agent, and the library read again. */
  const made = async (agent: ChatAgent, kind: ToolKind, tool: Tool) => {
    await giveTool(agent.id, kind, tool.id);
    await load();
    gave(tool.name, agent);
    return tool;
  };
  const others = (kind: ToolKind) => (library ?? []).filter((x) => x.kind === kind);

  /** A card's look and words, by its key. */
  const text = (key: string): [title: string, short: string, help: string] =>
    key === "browser"
      ? [t("agents.general.browserAccess"), t("agents.tools.short.browser"), t("agents.general.browserAccessHelp")]
      : key === "devtools"
        ? [t("agents.general.browserDevtools"), t("agents.tools.short.devtools"), t("agents.general.browserDevtoolsOnHelp")]
        : [t(`agents.tools.${key}.title`), t(`agents.tools.${key}.short`), t(`agents.tools.${key}.help`)];
  const lookOf = (key: string) => (key === "browser" ? BROWSER_LOOK : key === "devtools" ? DEVTOOLS_LOOK : TEMPLATE_LOOK[key as keyof typeof TEMPLATE_LOOK]);
  /** Which kinds of agent may have it, when not every agent may. */
  const tag = (key: string) =>
    types && listing(key, types).length > 0 ? (
      <span className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-200">{whoMay(key, types, t, "for")}</span>
    ) : undefined;

  /** A pack — Browser access, the web development tools — is a flag of the agent's settings. */
  const packHas = (devtools: boolean) => (a: ChatAgent) =>
    fetchAgentDetail(a.id).then((d) => d.config.browser_access !== false && (!devtools || d.config.browser_devtools === true));
  const givePack = (devtools: boolean, title: string) => (agent: ChatAgent) =>
    void attempt(async () => {
      const d = await fetchAgentDetail(agent.id);
      await saveAgentConfig(agent.id, { ...d.config, browser_access: true, ...(devtools ? { browser_devtools: true } : {}) });
      gave(title, agent);
    });
  /** A template's dialog, for the agent picked: a site tool's with the links it has. */
  const openTemplate = (key: Making) => (agent: ChatAgent) =>
    void attempt(async () => {
      const has = SITE_KEYS.has(key) || key === "sql" ? (await fetchAgentTools(agent.id)).tools : [];
      const links = has.filter((x) => x.kind === key).map((x) => ({ description: x.description, address: x.name }));
      setMaking({ key, agent, links, connections: has.filter(isConnection) });
    });

  const template = (key: string) => {
    const [title, short, help] = text(key);
    const look = lookOf(key);
    const pack = key === "browser" || key === "devtools";
    const actions =
      key === "folder" ? (
        <span className={cn(muted, "flex shrink-0 items-center gap-1 text-[11px]")} title={t("agents.tools.folder.onMac")}>
          <Laptop size={14} aria-hidden />
          {t("agents.tools.folder.onMacAction")}
        </span>
      ) : (
        <AgentPicker title={title} toolKey={key} has={pack ? packHas(key === "devtools") : undefined} onPick={pack ? givePack(key === "devtools", title) : openTemplate(key as Making)} />
      );
    return (
      <ToolRowFrame key={`template-${key}`} icon={look[0]} color={look[1]} title={title} short={short} help={help} hover actions={actions}>
        {tag(key)}
      </ToolRowFrame>
    );
  };
  const yours = (x: Tool) => {
    const key = keyOf(x.kind);
    const look = lookOf(key);
    return (
      <ToolRowFrame
        key={`tool-${x.id}`}
        icon={look[0]}
        color={look[1]}
        title={x.name}
        short={x.description}
        help={t("tools.yoursHelp")}
        hover
        actions={
          <AgentPicker
            title={x.name}
            toolKey={key}
            has={(a) => fetchAgentTools(a.id).then((r) => r.tools.some((m) => m.id === x.id))}
            onPick={(agent) =>
              void attempt(async () => {
                await giveTool(agent.id, x.kind, x.id);
                gave(x.name, agent);
              })
            }
          />
        }
      >
        {tag(key)}
      </ToolRowFrame>
    );
  };

  const close = () => setMaking(null);
  // A SQL tool's page, for the agent picked, in place of the Tools page.
  if (making?.key === "sql")
    return (
      <SqlToolEditor
        connections={making.connections}
        others={others("sql").map((x) => x.name)}
        onSave={async (s: SqlTool) => {
          await made(making.agent, "sql", await createTool(sqlToolIn(s, true)));
          close();
        }}
        onBack={close}
        onConnect={() => {
          window.location.hash = `#/agents/${encodeURIComponent(making.agent.id)}/property`;
        }}
      />
    );
  const dialog = making && (
    <>
      {making.key === "local" && (
        <LocalProgramDialog
          others={others("program").map(programOf)}
          onClose={close}
          onSave={(p) => {
            close();
            void attempt(async () => made(making.agent, "program", await createTool({ kind: "program", name: p.name, description: p.description, config: { command: p.command, args: p.args } })));
          }}
        />
      )}
      {SITE_KEYS.has(making.key) && (
        <SiteDialog
          kind={making.key as SiteKind}
          initial={making.links}
          onClose={close}
          onSave={(links) => {
            close();
            const k = making.key as SiteKind;
            void attempt(async () => {
              await setAgentTools(making.agent.id, k, await siteToolIds(others(k), k, links));
              await load();
              gave(t(`agents.tools.${k}.title`), making.agent);
            });
          }}
        />
      )}
    </>
  );

  const keys = tab ? TAB_TOOLS[tab] : LIBRARY_TABS.flatMap((k) => TAB_TOOLS[k]);
  const mine = (library ?? []).filter((x) => keys.includes(keyOf(x.kind)));
  const heading = "px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400";
  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <p className={cn(muted, "text-sm")}>{t("tools.intro")}</p>
      {error && <div className={errorBanner}>{error}</div>}
      <div>
        <div role="region" aria-label={tab ? t(`agents.tools.tabs.${tab}`) : t("tools.nav.all")} className="flex flex-col gap-5">
          <section aria-label={t("tools.templates")}>
            <h2 className={heading}>{t("tools.templates")}</h2>
            <div className={GRID}>{keys.map(template)}</div>
          </section>
          <section aria-label={t("tools.yours")}>
            <h2 className={heading}>{t("tools.yours")}</h2>
            {library === null ? (
              <p className={loading}>{t("tools.loading")}</p>
            ) : mine.length > 0 ? (
              <div className={GRID} data-track-private>
                {mine.map(yours)}
              </div>
            ) : (
              <p className={cn(muted, "px-3 py-2 text-sm")}>{t("tools.noneYours")}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Who may have a tool only some agent types list: in the page's words for a browser's or a
 * computer's (`tools.for.browser`…), else the types' own names. */
function whoMay(key: string, types: readonly AgentType[], t: (k: string) => string, how: "for" | "only"): string {
  const who = listing(key, types);
  const kinds = new Set(who.map((x) => x.kind));
  const [only] = kinds;
  return kinds.size === 1 && (only === "browser" || only === "osx") ? t(`tools.${how}.${only}`) : who.map((x) => x.name).join(", ");
}
