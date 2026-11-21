import { Fragment, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, CodeXml, Database, DatabaseZap, FolderOpen, Globe, Laptop, Link2, Mail, Newspaper, MonitorPlay, Pencil, Plane, Plus, Snowflake, SquareTerminal, TabletSmartphone, Terminal, ToggleRight, Trash2, Code, Smartphone, type LucideIcon } from "lucide-react";
import { cn, errorBanner, muted } from "@shared/cn";
import {
  createTool,
  declineSkillRequest,
  deleteTool,
  fetchSkillRequests,
  giveRequestedSkill,
  fetchAgentTools,
  fetchBrowserLinks,
  fetchTools,
  isConnection,
  setAgentTools,
  SITE_KINDS,
  sqlToolIn,
  sqlToolOf,
  updateTool,
  type BrowserLink,
  type SiteKind,
  type SiteLink,
  type SkillRequest,
  type SqlTool,
  type Tool,
  type ToolKind,
} from "../../api";
import { MAX_PROGRAMS, programsOf, type LocalProgram } from "../../cloud/localPrograms";
import { LocalProgramDialog } from "./LocalProgramDialog";
import { SqlToolEditor } from "./SqlToolEditor";
import { hasPending, INSTRUCTION_FIELD, instructionOf, isDraft, Proposals, requestsOf, REQUESTS_FIELD } from "./Proposals";
import { INSTRUCTIONS_FIELD } from "./shared";
import { computerOf, onWindows, runsOn, windowsProgramsToOffer } from "../../cloud/windowsPrograms";
import { SiteDialog } from "./SiteDialog";
import { MAC_FOLDERS_FIELD } from "./shared";
import { MAX_SITES } from "./sites";
import { agentKind, mayAdd, switchesOf } from "./toolKinds";
import { useAgentTypes } from "../../agentTypes";
import { siteToolIds } from "./toolSaves";
import { dialogs as ask } from "../common/confirm";

/** How often the agent's link is read again while the Tools tab shows: a browser or a Mac connects and goes on its own, and a program is allowed on
 * the Mac, not here. */
export const LINK_REFRESH_MS = 5000;

/** The Tool library's tabs, in order. */
export const LIBRARY_TABS = ["local", "website", "database"] as const;
export type LibraryTab = (typeof LIBRARY_TABS)[number];
/** Which tools each tab holds, by catalog key: a tab with none this agent may add is not shown. */
export const TAB_TOOLS: Record<LibraryTab, readonly string[]> = {
  local: ["folder", "local"],
  website: ["browser", "devtools", ...SITE_KINDS],
  // A SQL Query tool over one of the agent's connections (2026-11-17): the connections
  // themselves are on its General tab, not tools the AI sees.
  database: ["sql"],
};
/** At most so many SQL tools an agent (apps/cloud/user_tools.py `PER_AGENT`). */
export const MAX_SQL_TOOLS = 50;

export const GRID = "grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2";
// Each tool's icon and colour.
export const BROWSER_LOOK = [Globe, "text-sky-600 dark:text-sky-400"] as const;
export const DEVTOOLS_LOOK = [CodeXml, "text-amber-600 dark:text-amber-400"] as const;
const LOCAL_COLOR = "text-violet-600 dark:text-violet-400";
const FOLDER_COLOR = "text-yellow-600 dark:text-yellow-400";
type Computer = ReturnType<typeof computerOf>;
const EVERY: readonly Computer[] = ["mac", "windows", "linux"];
/** A computer's packs (a Mac's, a Windows PC's or a Linux machine's agent), each one switch in
 * its settings — offered as the agent's type lists them (Wysebee Cloud's agent types: a Linux
 * machine has no screen, the iPhone toolkit is a Mac's alone); `computers`: the computers whose
 * words it is said in (one: its own words). */
const PC_PACKS: readonly { key: string; field: string; icon: LucideIcon; computers: readonly Computer[] }[] = [
  { key: "anyProgram", field: "run_any_program", icon: Terminal, computers: EVERY },
  { key: "screen", field: "screen_control", icon: MonitorPlay, computers: ["mac", "windows"] },
  { key: "developer", field: "developer_access", icon: Code, computers: EVERY },
  { key: "androidToolkit", field: "android_toolkit", icon: Smartphone, computers: EVERY },
  { key: "iosToolkit", field: "ios_toolkit", icon: TabletSmartphone, computers: ["mac"] },
];
/** Each computer's words for a pack several have: a Windows PC's are the plain keys. */
const WORDS: Record<Computer, string> = { windows: "", mac: "Mac", linux: "Linux" };
/** The switches drawn by their own rows here; any other a type lists is drawn as a plain toggle
 * with Wysebee Cloud's words. */
const KNOWN_SWITCHES: ReadonlySet<string> = new Set(["browser_access", "browser_devtools", ...PC_PACKS.map((p) => p.field)]);
const POSTGRES_COLOR = "text-sky-700 dark:text-sky-400";
const SNOWFLAKE_COLOR = "text-cyan-600 dark:text-cyan-400";
const SITE_LOOK: Record<SiteKind, readonly [LucideIcon, string]> = {
  gmail: [Mail, "text-red-600 dark:text-red-400"],
  calendar: [CalendarDays, "text-blue-600 dark:text-blue-400"],
  travel: [Plane, "text-teal-600 dark:text-teal-400"],
  news: [Newspaper, "text-amber-600 dark:text-amber-400"],
  website: [Link2, "text-indigo-600 dark:text-indigo-400"],
};
export const SQL_LOOK = [DatabaseZap, "text-emerald-600 dark:text-emerald-400"] as const;
export const TEMPLATE_LOOK = { local: [SquareTerminal, LOCAL_COLOR], folder: [FolderOpen, FOLDER_COLOR], postgres: [Database, POSTGRES_COLOR], snowflake: [Snowflake, SNOWFLAKE_COLOR], sql: SQL_LOOK, ...SITE_LOOK } as const;

const EDIT_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700";
const REMOVE_BUTTON = "shrink-0 rounded p-1 text-stone-500 hover:bg-red-50 hover:text-red-600 dark:text-stone-400 dark:hover:bg-red-950 dark:hover:text-red-400";
export const ADD_BUTTON = "shrink-0 rounded-lg p-1.5 text-stone-700 hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40 dark:text-stone-200 dark:hover:bg-stone-700 dark:hover:text-white";

/** One of the Mac's folders, as its Mac said it. */
interface MacFolder {
  id: string;
  name: string;
  path: string;
  mode: string;
  description: string;
}

const objects = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)) : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function macFoldersOf(v: unknown): MacFolder[] {
  return objects(v)
    .filter((f) => str(f.name))
    .map((f) => ({ id: str(f.id), name: str(f.name), path: str(f.path), mode: str(f.mode), description: str(f.description) }));
}

/** An agent's link — its paired browser or Mac — as the account's list has it now; null
 * until read, or when it cannot be. */
function useAgentLink(linkId: string): BrowserLink | null {
  const [link, setLink] = useState<BrowserLink | null>(null);
  useEffect(() => {
    if (!linkId) return;
    let live = true;
    const read = () =>
      fetchBrowserLinks().then(
        (r) => live && setLink(r.links.find((l) => l.id === linkId) ?? null),
        () => {},
      );
    void read();
    const timer = window.setInterval(() => void read(), LINK_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [linkId]);
  return linkId ? link : null;
}

/** The agent's tools and the person's whole library of them (apps/cloud/user_tools.py): read
 * on opening and again after each change, which is saved at once. */
function useTools(agentId: string) {
  // Null until read: nothing can be added before the agent's tools are known.
  const [mine, setMine] = useState<Tool[] | null>(null);
  const [library, setLibrary] = useState<Tool[]>([]);
  const [skillRequests, setSkillRequests] = useState<SkillRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      // The skills the person's AI app asks for it: none when they cannot be read.
      const [agent, all, asked] = await Promise.all([fetchAgentTools(agentId), fetchTools(), fetchSkillRequests(agentId).catch(() => ({ requests: [] }))]);
      setMine(agent.tools);
      setLibrary(all.tools);
      setSkillRequests(asked.requests);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [agentId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { mine: mine ?? [], ready: mine !== null, library, skillRequests, error, setError, load };
}

/** A program tool as the dialog and its row read it (Wysebee Cloud keeps only programs that
 * can be read). */
export function programOf(t: Tool): LocalProgram {
  return programsOf([{ name: t.name, description: t.description, ...t.config }])[0]!;
}

/** The Tool library's tabs (Local File & Folder, Website, Database): here and on the Tools page. */
export function LibraryTabStrip({ tabs, shown, onSelect }: { tabs: readonly LibraryTab[]; shown: LibraryTab; onSelect: (tab: LibraryTab) => void }) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-700" role="tablist" aria-label={t("agents.tools.library")}>
      {tabs.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={shown === key}
          className={cn(
            "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors",
            shown === key
              ? "border-primary-600 text-primary-700 dark:border-primary-400 dark:text-primary-300"
              : "border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200",
          )}
          onClick={() => onSelect(key)}
          data-track={`Tool library ${key}`}
        >
          {t(`agents.tools.tabs.${key}`)}
        </button>
      ))}
    </div>
  );
}

/** A row's look, whatever it stands for. */
export function ToolRowFrame({
  icon: Icon,
  color,
  title,
  short,
  help,
  hover,
  actions,
  onShort,
  children,
}: {
  icon: LucideIcon;
  color: string;
  title: string;
  short: string;
  help: string;
  hover?: boolean;
  actions?: React.ReactNode;
  onShort?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl px-3 py-2.5", hover && "hover:bg-stone-100 dark:hover:bg-stone-800/60")}>
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-700 dark:bg-stone-900">
          <Icon size={22} className={color} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{title}</h4>
          {onShort ? (
            <button
              type="button"
              className={cn(muted, "block max-w-full truncate text-left text-xs underline-offset-2 hover:text-stone-800 hover:underline dark:hover:text-stone-100")}
              onClick={onShort}
              title={help}
              data-track="Tool row line"
            >
              {short}
            </button>
          ) : (
            <p className={cn(muted, "truncate text-xs")} title={help}>
              {short}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children && <div className="pl-14">{children}</div>}
    </div>
  );
}

/**
 * The Tools tab: two tabs, **Installed tools** (with their count) and the **Tool
 * library** (in tabs of its own: Local File & Folder, Website, Database — only those with
 * something this agent may add), every tool a compact row in one or two columns. Without edit
 * rights there is no library.
 *
 * **Each tool is shown only to the kind of agent that may add it** (toolKinds.ts, as Wysebee
 * Cloud's agent types say): the browser's tools and the site tools to an agent made by pairing
 * the browser extension; Run local program and Local Folder to one made by pairing Wysebee Agent
 * for Mac, Windows or Linux; **its switches are its type's** — a switch this page has no row for
 * (a new kind of device's) is a plain toggle in Wysebee Cloud's words. Nothing is offered until
 * the types are read. What an agent kept from before still shows under Installed tools.
 *
 * Browser access and the web development tools are flags of the agent's settings, saved with
 * the settings' Save. **Everything else the person sets up here is one of their tools**
 * (2026-11-15, apps/cloud/user_tools.py): PostgreSQL and Snowflake connections, the site tools'
 * links and a Mac agent's programs — each kept in their account with an id, so it can be
 * renamed, and given to as many agents as they like: **made, changed, given and taken away
 * here at once** (CloudPostgres.tsx, CloudSnowflake.tsx, SiteDialog, LocalProgramDialog). The
 * library lists the person's tools this agent does not have yet, each with a + that gives it.
 * Taking one away (the trash) leaves it in the library. A Mac agent's folders are picked in
 * Wysebee Agent on the Mac and only listed.
 */
export function ToolCards({
  config,
  onChange,
  canEdit,
  agentId,
  onConnect,
  onInstructions,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  canEdit: boolean;
  /** Whose tools: the agent's id, which its tools are given to. */
  agentId: string;
  /** Open the agent's General tab, where its database connections are. */
  onConnect: () => void;
  /** Open the agent's Instruction tab. */
  onInstructions: () => void;
}) {
  const { t } = useTranslation();
  // Which tools and switches this agent may have: its type's, as Wysebee Cloud says (none until read).
  const types = useAgentTypes();
  const kind = types ? agentKind(config, types) : "plain";
  const may = (key: string) => mayAdd(config, key, types);
  const switches = switchesOf(config, types);
  const hasSwitch = (field: string) => switches.some((x) => x.field === field);
  // A switch of its type this page has no row of its own for (a new kind of device's): a toggle.
  const generic = switches.filter((x) => !KNOWN_SWITCHES.has(x.field)).map((x) => ({ ...x, on: config[x.field] === true }));
  const browserLink = kind === "browser" ? str(config.browser_link) : "";
  const macLink = kind === "osx" ? str(config.mac_link) : "";
  const link = useAgentLink(browserLink || macLink);
  const paired = may("browser");
  const onMac = may("local");
  const browserAccess = config.browser_access !== false;
  const devtools = config.browser_devtools === true;
  // A computer's packs, each answered only while its switch is on in Wysebee Agent there: Run
  // any program (the AI names the program), Screen control, Developer access and the Android
  // Development Toolkit — a Windows PC's agent (2026-11-16) or a Mac's (2026-11-17), in that
  // computer's words — and the iPhone Development Toolkit, a Mac's alone (Xcode).
  const computer = computerOf(config);
  const pcPacks = PC_PACKS.filter((p) => onMac && hasSwitch(p.field)).map((p) => ({ ...p, on: config[p.field] === true }));
  // A Mac's or a Linux machine's words for a pack several computers have (`shortMac`, `helpLinux`…); a one-computer pack's are its own.
  const said = (p: (typeof PC_PACKS)[number], what: "short" | "help") => t(`agents.tools.${p.key}.${what}${p.computers.length === 1 ? "" : WORDS[computer]}`);
  const tools = useTools(agentId);
  // What the agent has, without the drafts from the person's AI app (they wait in Proposals).
  const of = (k: ToolKind) => tools.mine.filter((x) => x.kind === k && !isDraft(x));
  const ids = (k: ToolKind) => of(k).map((x) => x.id);
  const drafts = tools.mine.filter(isDraft);
  const sites = Object.fromEntries(SITE_KINDS.map((k) => [k, of(k).map((x) => ({ description: x.description, address: x.name }))])) as Record<SiteKind, SiteLink[]>;
  // A Mac's agent's programs are its tools.
  const programTools = onMac ? of("program") : [];
  const programs: LocalProgram[] = programTools.map(programOf);
  const folders = onMac ? (link?.folders ? macFoldersOf(link.folders) : macFoldersOf(config[MAC_FOLDERS_FIELD])) : [];
  // Its database connections (set on its General tab) and its SQL Query tools over them.
  const connections = tools.mine.filter(isConnection);
  const sqlTools = of("sql");
  const connectionName = (id: string) => connections.find((c) => c.id === id)?.name;

  const [view, setView] = useState<"installed" | "library">("installed");
  const [tab, setLibraryTab] = useState<LibraryTab>("local");
  const [editingSite, setEditingSite] = useState<SiteKind | null>(null);
  // The program being made ("new") or changed (its place in the list).
  const [editingProgram, setEditingProgram] = useState<number | "new" | null>(null);
  // A new program's starting values: a ready-made Windows one (cloud/windowsPrograms.ts).
  const [draft, setDraft] = useState<LocalProgram | undefined>(undefined);
  // The SQL tool being made ("new") or changed: its page shows in place of the tab's.
  const [editingSql, setEditingSql] = useState<SqlTool | "new" | null>(null);

  const added = { browser: paired && browserAccess, devtools: paired && browserAccess && devtools };
  const set = (patch: Record<string, unknown>) => onChange({ ...config, ...patch });
  // Tools are saved at once (not with the settings' Save), then read again.
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await tools.load();
    } catch (e) {
      tools.setError((e as Error).message);
    }
  };
  // A kind's tools as given here, its drafts kept (they are given while they wait).
  const give = (k: ToolKind, list: string[]) => setAgentTools(agentId, k, [...list, ...drafts.filter((x) => x.kind === k && !list.includes(x.id)).map((x) => x.id)]);
  const takeAway = (k: ToolKind, id: string) => run(() => give(k, ids(k).filter((i) => i !== id)));
  /** A draft from the person's AI app, thrown away once asked: deleted, not kept in the library. */
  const discardDraft = async (x: Tool) => {
    if (!(await ask.confirm(t("agents.tools.sql.confirmDiscard", { name: x.name }), { action: "discard" }))) return;
    void run(() => deleteTool(x.id));
  };
  /** A drafted site link or program, created as it is: saved here, so no longer a draft. */
  const createDraft = (x: Tool) => {
    const { draft: _draft, ...config } = x.config;
    void run(() => updateTool(x.id, { name: x.name, description: x.description, config }));
  };
  /** A switch the AI app asked for: turned on (the web development tools with Browser access),
   * or declined — each with the settings' Save. */
  const requests = requestsOf(config);
  const answer = (field: string, on: boolean) => {
    // Only called for a request listed, so the field holds them.
    const { [field]: _asked, ...rest } = config[REQUESTS_FIELD] as Record<string, unknown>;
    set({ ...(on ? { [field]: true, ...(field === "browser_devtools" ? { browser_access: true } : {}) } : {}), [REQUESTS_FIELD]: rest });
  };
  const switchText = (field: string): [string, string] => {
    if (field === "browser_access") return [browserTitle, t("agents.general.browserAccessHelp")];
    if (field === "browser_devtools") return [devtoolsTitle, t("agents.general.browserDevtoolsOnHelp")];
    const p = PC_PACKS.find((x) => x.field === field);
    if (p) return [t(`agents.tools.${p.key}.title`), said(p, "help")];
    const other = switches.find((x) => x.field === field);
    return other ? [other.label, other.description] : [field, ""];
  };
  /** A change proposed to a SQL tool, thrown away: the tool saved as it is. */
  const discardChange = async (s: SqlTool) => {
    const { pending: _pending, ...current } = s;
    await updateTool(s.id, sqlToolIn(current));
    await tools.load();
    setEditingSql(null);
  };
  /** The SQL tool page's save: changed in the person's tools, or made and given to this agent;
   * the page says a refusal. */
  const saveSql = async (s: SqlTool, fresh: boolean) => {
    if (fresh) {
      const made = await createTool(sqlToolIn(s, true));
      await give("sql", [...ids("sql"), made.id]);
    } else await updateTool(s.id, sqlToolIn(s));
    await tools.load();
    setEditingSql(null);
  };
  const saveProgram = (program: LocalProgram, at: number | "new") =>
    run(async () => {
      const body = { name: program.name, description: program.description, config: { command: program.command, args: program.args } };
      if (at !== "new") return updateTool(programTools[at].id, body);
      const made = await createTool({ kind: "program", ...body });
      return give("program", [...ids("program"), made.id]);
    });
  /** A site tool's links as its dialog saves them: each the person's tool of that address
   * (made, or its description changed), given to this agent in that order. */
  const saveSites = (k: SiteKind, links: SiteLink[]) => run(async () => give(k, await siteToolIds(tools.library, k, links)));

  const editRemove = (title: string, onEdit?: () => void, onRemove?: () => void) =>
    canEdit && (
      <>
        {onEdit && (
          <button type="button" className={EDIT_BUTTON} onClick={onEdit} aria-label={t("agents.tools.local.edit", { name: title })} title={t("agents.tools.local.edit", { name: title })}>
            <Pencil size={15} aria-hidden />
          </button>
        )}
        {onRemove && (
          <button type="button" className={REMOVE_BUTTON} onClick={onRemove} aria-label={t("agents.tools.remove", { section: title })} title={t("agents.tools.remove", { section: title })}>
            <Trash2 size={15} aria-hidden />
          </button>
        )}
      </>
    );
  /** In place of a +: where the tool is set up instead. */
  const elsewhere = (text: string, note: string, Icon: LucideIcon = Laptop) => (
    <span className={cn(muted, "flex shrink-0 items-center gap-1 text-[11px]")} title={note}>
      <Icon size={14} aria-hidden />
      {text}
    </span>
  );

  const browserTitle = t("agents.general.browserAccess");
  const devtoolsTitle = t("agents.general.browserDevtools");
  const installed = (
    <div className={GRID}>
      {added.browser && (
        <ToolRowFrame
          icon={BROWSER_LOOK[0]}
          color={BROWSER_LOOK[1]}
          title={browserTitle}
          short={link ? t(`agents.tools.browserPaired.${link.paused ? "paused" : link.status}`, { browser: link.browser }) : t("agents.tools.browserPaired.unknown")}
          help={t("agents.general.browserAccessHelp")}
          actions={editRemove(browserTitle, undefined, () => set({ browser_access: false, browser_devtools: false }))}
        />
      )}
      {added.devtools && (
        <ToolRowFrame icon={DEVTOOLS_LOOK[0]} color={DEVTOOLS_LOOK[1]} title={devtoolsTitle} short={t("agents.tools.short.devtools")} help={t("agents.general.browserDevtoolsOnHelp")} actions={editRemove(devtoolsTitle, undefined, () => set({ browser_devtools: false }))} />
      )}
      {generic
        .filter((x) => x.on)
        .map((x) => (
          <ToolRowFrame
            key={`switch-${x.field}`}
            icon={ToggleRight}
            color={LOCAL_COLOR}
            title={x.label}
            short={x.description || x.label}
            help={x.description}
            actions={editRemove(x.label, undefined, () => set({ [x.field]: false }))}
          />
        ))}
      {pcPacks
        .filter((p) => p.on)
        .map((p) => (
          <ToolRowFrame
            key={`pc-${p.key}`}
            icon={p.icon}
            color={LOCAL_COLOR}
            title={t(`agents.tools.${p.key}.title`)}
            short={said(p, "short")}
            help={said(p, "help")}
            actions={editRemove(t(`agents.tools.${p.key}.title`), undefined, () => set({ [p.field]: false }))}
          />
        ))}
      {programs.length > 0 && (
        <p role="note" className={cn("col-span-full px-3 pt-1 text-xs", muted)} data-track-private>
          {link ? t(`agents.tools.macPaired.${link.paused ? "paused" : link.status}`, { mac: link.browser }) : t("agents.tools.macPaired.unknown")}
        </p>
      )}
      {programs.map((p, i) => {
        const allowed = link ? (link.approved ?? []).includes(p.name) : undefined;
        const actions = editRemove(p.name, () => setEditingProgram(i), () => void takeAway("program", programTools[i].id));
        return (
          <ToolRowFrame
            key={`program-${p.name}`}
            icon={SquareTerminal}
            color={LOCAL_COLOR}
            title={p.name}
            short={p.description}
            help={p.command}
            onShort={canEdit ? () => setEditingProgram(i) : undefined}
            actions={actions}
          >
            <code className={cn(muted, "mt-1 block truncate font-mono text-[11px]")}>{[p.command, ...p.args.map((a) => ("param" in a ? `<${a.param}>` : a.value))].join(" ")}</code>
            {allowed === true && <p className="mt-1 text-[11px] text-green-700 dark:text-green-400">{t("agents.tools.local.allowed")}</p>}
            {allowed === false && (
              <p className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">{t("agents.tools.local.waiting")}</p>
            )}
          </ToolRowFrame>
        );
      })}
      {folders.length > 0 && (
        <ToolRowFrame icon={FolderOpen} color={FOLDER_COLOR} title={t("agents.tools.folder.title")} short={t("agents.tools.folder.count", { count: folders.length })} help={t("agents.tools.folder.help")}>
          <ul className="mt-1 space-y-1.5" data-track-private>
            {folders.map((f) => (
              <li key={f.id || f.path} className="min-w-0 text-xs">
                <span className="font-medium text-stone-800 dark:text-stone-100">{f.name}</span>
                <span className={cn(muted, "text-[11px]")}> · {t(f.mode === "write" ? "agents.tools.folder.write" : "agents.tools.folder.read")}</span>
                <code className={cn(muted, "block truncate font-mono text-[11px]")} title={f.path}>
                  {f.path}
                </code>
                {f.description && <p className={cn(muted, "text-[11px]")}>{f.description}</p>}
              </li>
            ))}
          </ul>
          <p role="note" className={cn(muted, "mt-2 text-[11px]")}>
            {t("agents.tools.folder.onMac")}
          </p>
        </ToolRowFrame>
      )}
      {sqlTools.map((x) => {
        const sql = sqlToolOf(x);
        const on = connectionName(sql.connectionId);
        return (
          <ToolRowFrame
            key={`sql-${x.id}`}
            icon={SQL_LOOK[0]}
            color={SQL_LOOK[1]}
            title={x.name}
            short={x.description}
            help={sql.sql}
            onShort={canEdit ? () => setEditingSql(sql) : undefined}
            actions={editRemove(x.name, () => setEditingSql(sql), () => void takeAway("sql", x.id))}
          >
            {sql.pending ? (
              <button type="button" className="mt-1 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-900 hover:bg-violet-200 dark:bg-violet-900 dark:text-violet-100" onClick={() => setEditingSql(sql)} disabled={!canEdit}>
                {t("agents.tools.sql.changeBadge")}
              </button>
            ) : on ? (
              <p className={cn(muted, "mt-1 text-[11px]")}>{t("agents.tools.sql.on", { name: on })}</p>
            ) : (
              <p className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-900 dark:text-amber-100">{t("agents.tools.sql.notConnected")}</p>
            )}
          </ToolRowFrame>
        );
      })}
      {SITE_KINDS.filter((k) => sites[k].length > 0).map((k) => {
        const title = t(`agents.tools.${k}.title`);
        return (
          <ToolRowFrame
            key={`site-${k}`}
            icon={SITE_LOOK[k][0]}
            color={SITE_LOOK[k][1]}
            title={title}
            short={t(`agents.tools.${k}.count`, { count: sites[k].length })}
            help={t(`agents.tools.${k}.help`)}
            onShort={canEdit ? () => setEditingSite(k) : undefined}
            actions={editRemove(title, () => setEditingSite(k), () => void run(() => give(k, [])))}
          />
        );
      })}
    </div>
  );

  /** A library row: its look, its title and one line, and its + — or where it is set up. */
  const template = (key: keyof typeof TEMPLATE_LOOK, onAdd?: () => void, disabled = false, instead?: React.ReactNode) => {
    const title = t(`agents.tools.${key}.title`);
    return (
      <ToolRowFrame
        icon={TEMPLATE_LOOK[key][0]}
        color={TEMPLATE_LOOK[key][1]}
        title={title}
        short={t(`agents.tools.${key}.short`)}
        help={t(`agents.tools.${key}.help`)}
        hover
        actions={
          instead ?? (
            <button type="button" className={ADD_BUTTON} onClick={onAdd} disabled={disabled} aria-label={t("agents.tools.addSection", { section: title })} title={t("agents.tools.addSection", { section: title })} data-track={`Add tools ${key}`}>
              <Plus size={22} strokeWidth={1.75} aria-hidden />
            </button>
          )
        }
      />
    );
  };
  /** A pack's library row (Browser access, the web development tools). */
  const pack = (look: readonly [LucideIcon, string], title: string, short: string, help: string, hint: string, add: () => void) => (
    <ToolRowFrame
      icon={look[0]}
      color={look[1]}
      title={title}
      short={short}
      help={help}
      hover
      actions={
        <button type="button" className={ADD_BUTTON} onClick={add} aria-label={t("agents.tools.addSection", { section: title })} title={hint} data-track="Add tools pack">
          <Plus size={22} strokeWidth={1.75} aria-hidden />
        </button>
      }
    />
  );
  /** The person's tools of a kind this agent does not have yet: each given with its +; `keep`:
   * only those that make sense for it. */
  const fromLibrary = (k: ToolKind, look: readonly [LucideIcon, string], full: boolean, keep: (x: Tool) => boolean = () => true) =>
    tools.library
      .filter((x) => x.kind === k && !tools.mine.some((m) => m.id === x.id) && keep(x))
      .map((x) => (
        <Fragment key={`library-${x.id}`}>
          <ToolRowFrame
            icon={look[0]}
            color={look[1]}
            title={x.name}
            short={x.description}
            help={t("agents.tools.fromLibrary")}
            hover
            actions={
              <button type="button" className={ADD_BUTTON} onClick={() => void run(() => give(k, [...ids(k), x.id]))} disabled={full} aria-label={t("agents.tools.give", { name: x.name })} title={t("agents.tools.give", { name: x.name })} data-track="Give tool">
                <Plus size={22} strokeWidth={1.75} aria-hidden />
              </button>
            }
          />
        </Fragment>
      ));
  // A switch of its type this page does not know, off: added with its +.
  const genericOff = generic
    .filter((x) => !x.on)
    .map((x) => <Fragment key={`switch-${x.field}`}>{pack([ToggleRight, LOCAL_COLOR], x.label, x.description || x.label, x.description, t("agents.tools.addSection", { section: x.label }), () => set({ [x.field]: true }))}</Fragment>);
  const items: Record<LibraryTab, React.ReactNode[]> = {
    local: [
      ...genericOff,
      ...(onMac
      ? [
          ...(folders.length === 0 ? [<Fragment key="folder">{template("folder", undefined, false, elsewhere(t("agents.tools.folder.onMacAction"), t("agents.tools.folder.onMac")))}</Fragment>] : []),
          <Fragment key="local">{template("local", () => { setDraft(undefined); setEditingProgram("new"); }, !tools.ready || programs.length >= MAX_PROGRAMS)}</Fragment>,
          ...pcPacks
            .filter((p) => !p.on)
            .map((p) => (
              <Fragment key={`pc-${p.key}`}>
                {pack([p.icon, LOCAL_COLOR], t(`agents.tools.${p.key}.title`), said(p, "short"), said(p, "help"), t("agents.tools.addSection", { section: t(`agents.tools.${p.key}.title`) }), () => set({ [p.field]: true }))}
              </Fragment>
            )),
          // A Windows PC's agent: the ready-made tools whose name none of the person's programs has.
          ...(onWindows(config)
            ? windowsProgramsToOffer(tools.library.filter((x) => x.kind === "program")).map((p) => (
                <Fragment key={`windows-${p.name}`}>
                  <ToolRowFrame
                    icon={SquareTerminal}
                    color={LOCAL_COLOR}
                    title={p.name}
                    short={p.description}
                    help={t("agents.tools.local.windowsHelp")}
                    hover
                    actions={
                      <button
                        type="button"
                        className={ADD_BUTTON}
                        onClick={() => {
                          setDraft(p);
                          setEditingProgram("new");
                        }}
                        disabled={!tools.ready || programs.length >= MAX_PROGRAMS}
                        aria-label={t("agents.tools.give", { name: p.name })}
                        title={t("agents.tools.give", { name: p.name })}
                        data-track="Add Windows program"
                      >
                        <Plus size={22} strokeWidth={1.75} aria-hidden />
                      </button>
                    }
                  />
                </Fragment>
              ))
            : []),
          // Only programs this computer can run: a Windows PC's systeminfo is not offered to a Linux machine.
          ...fromLibrary("program", [SquareTerminal, LOCAL_COLOR], programs.length >= MAX_PROGRAMS, (x) => runsOn({ command: typeof x.config.command === "string" ? x.config.command : "" }, computer)),
        ]
      : []),
    ],
    website: [
      ...(paired && !added.browser ? [<Fragment key="browser">{pack(BROWSER_LOOK, browserTitle, t("agents.tools.short.browser"), t("agents.general.browserAccessHelp"), t("agents.tools.addSection", { section: browserTitle }), () => set({ browser_access: true }))}</Fragment>] : []),
      ...(paired && !added.devtools && hasSwitch("browser_devtools")
        ? [
            <Fragment key="devtools">
              {pack(DEVTOOLS_LOOK, devtoolsTitle, t("agents.tools.short.devtools"), t("agents.general.browserDevtoolsOnHelp"), added.browser ? t("agents.tools.addSection", { section: devtoolsTitle }) : t("agents.tools.addsBrowser"), () => set({ browser_access: true, browser_devtools: true }))}
            </Fragment>,
          ]
        : []),
      ...(paired ? SITE_KINDS.filter((k) => sites[k].length === 0).map((k) => <Fragment key={`site-${k}`}>{template(k, () => setEditingSite(k), !tools.ready)}</Fragment>) : []),
      ...(paired ? SITE_KINDS.flatMap((k) => fromLibrary(k, SITE_LOOK[k], sites[k].length >= MAX_SITES)) : []),
    ],
    database: [
      <Fragment key="sql">{template("sql", () => setEditingSql("new"), !tools.ready || sqlTools.length >= MAX_SQL_TOOLS)}</Fragment>,
      ...fromLibrary("sql", SQL_LOOK, sqlTools.length >= MAX_SQL_TOOLS),
    ],
  };
  const tabs = LIBRARY_TABS.filter((key) => TAB_TOOLS[key].some(may) || (key === "local" && genericOff.length > 0));
  const shown = tabs.includes(tab) ? tab : tabs[0];
  // Before the types are read nothing may be added: no tab yet.
  const library = shown ? (
    <div>
      <LibraryTabStrip tabs={tabs} shown={shown} onSelect={setLibraryTab} />
      <div role="tabpanel" aria-label={t(`agents.tools.tabs.${shown}`)}>
        {items[shown].length > 0 ? <div className={GRID}>{items[shown]}</div> : <p className={cn(muted, "px-3 py-2 text-sm")}>{t("agents.tools.allAdded")}</p>}
      </div>
    </div>
  ) : (
    <p className={cn(muted, "px-3 py-2 text-sm")}>{t("tools.typesLoading")}</p>
  );

  const siteCount = SITE_KINDS.filter((k) => sites[k].length > 0).length;
  const installedCount =
    (added.browser ? 1 : 0) +
    (added.devtools ? 1 : 0) +
    pcPacks.filter((p) => p.on).length +
    generic.filter((x) => x.on).length +
    programs.length +
    (folders.length > 0 ? 1 : 0) +
    sqlTools.length +
    siteCount;
  const errors = tools.error ? [tools.error] : [];
  const body = installedCount > 0 ? installed : <p className={cn(muted, "text-sm")}>{t(canEdit ? "agents.tools.noneYet" : "agents.tools.none")}</p>;
  const dialogs = (
    <>
      {editingProgram !== null && (
        <LocalProgramDialog
          initial={editingProgram === "new" ? undefined : programs[editingProgram]}
          draft={editingProgram === "new" ? draft : undefined}
          // Names are the person's once, across all their programs.
          others={tools.library.filter((x) => x.kind === "program" && (editingProgram === "new" || x.id !== programTools[editingProgram].id)).map(programOf)}
          onClose={() => setEditingProgram(null)}
          onSave={(program) => {
            void saveProgram(program, editingProgram);
            setEditingProgram(null);
          }}
        />
      )}
      {editingSite && (
        <SiteDialog
          kind={editingSite}
          initial={sites[editingSite]}
          onClose={() => setEditingSite(null)}
          onSave={(links) => {
            void saveSites(editingSite, links);
            setEditingSite(null);
          }}
        />
      )}
    </>
  );
  const errorBox = errors.map((e) => (
    <div key={e} className={cn(errorBanner, "text-xs")}>
      {e}
    </div>
  ));
  // A SQL tool's page, in place of the tab's.
  if (canEdit && editingSql !== null)
    return (
      <SqlToolEditor
        initial={editingSql === "new" ? undefined : editingSql}
        connections={connections}
        others={tools.library.filter((x) => x.kind === "sql" && (editingSql === "new" || x.id !== editingSql.id)).map((x) => x.name)}
        onSave={saveSql}
        onDiscardChange={discardChange}
        onBack={() => setEditingSql(null)}
        onConnect={onConnect}
      />
    );
  // Without edit rights there is nothing to add: what the agent has, alone.
  if (!canEdit)
    return (
      <div className="space-y-4">
        {errorBox}
        {body}
      </div>
    );
  return (
    <div className="space-y-4">
      {dialogs}
      {errorBox}
      {/* The tab's sections, and beside them what the AI app proposed (a panel from the right). */}
      <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="inline-flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800" role="tablist" aria-label={t("agents.tools.sections")}>
        {(["installed", "library"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
              view === key
                ? "border-stone-300 bg-white text-stone-900 shadow-sm dark:border-stone-500 dark:bg-stone-700 dark:text-white"
                : "border-stone-300 text-stone-600 hover:bg-white hover:text-stone-900 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-white",
            )}
            onClick={() => setView(key)}
            data-track={`Tools ${key}`}
          >
            {t(`agents.tools.${key}`)}
            {key === "installed" && <span className="rounded-full bg-stone-200 px-1.5 text-[11px] leading-4 dark:bg-stone-600">{installedCount}</span>}
          </button>
        ))}
      </div>
      <Proposals
        drafts={drafts}
        changes={sqlTools.filter(hasPending)}
        requests={requests}
        skills={tools.skillRequests}
        instruction={instructionOf(config)}
        onReviewInstruction={() => {
          // The proposal becomes the draft on the Instruction tab, saved (or not) with Save.
          const { [INSTRUCTION_FIELD]: proposed, ...rest } = config;
          onChange({ ...rest, [INSTRUCTIONS_FIELD]: (proposed as { text: string }).text });
          onInstructions();
        }}
        onDiscardInstruction={() => {
          const { [INSTRUCTION_FIELD]: _proposed, ...rest } = config;
          onChange(rest);
        }}
        onGiveSkill={(id) => void run(() => giveRequestedSkill(agentId, id))}
        onDeclineSkill={(id) => void run(() => declineSkillRequest(agentId, id))}
        onReview={(x) => setEditingSql(sqlToolOf(x))}
        onCreate={createDraft}
        onDiscard={discardDraft}
        onTurnOn={(f) => answer(f, true)}
        onDecline={(f) => answer(f, false)}
        switchText={switchText}
      />
      </div>
      <div role="tabpanel" aria-label={t(`agents.tools.${view}`)}>
        {view === "library" ? library : body}
      </div>
    </div>
  );
}
