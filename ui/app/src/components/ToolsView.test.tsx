import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import * as api from "../api";
import { TYPES } from "../../../test/agentTypes";
import { forgetAgentTypes, loadAgentTypes } from "../agentTypes";
import type { ChatAgent } from "../agents";
import { tool } from "../../../test/tools";
import { useState } from "react";
import type { LibraryTab } from "./AgentsView/ToolCards";
import { ToolsNav } from "./ToolsNav";
import { ToolsView } from "./ToolsView";

// The agents, as the store has them; the template dialogs, as stubs saying what they were given.
const h = vi.hoisted(() => ({
  agents: null as ChatAgent[] | null,
  load: vi.fn(),
  toast: vi.fn(),
  dialogs: {} as Record<string, Record<string, (...a: unknown[]) => unknown> & { others: unknown; initial?: unknown; kind?: string; connections?: unknown }>,
}));
vi.mock("../agents", () => ({ useAgents: () => ({ items: h.agents, error: null }), loadAgents: h.load }));
vi.mock("sonner", () => ({ toast: { success: h.toast } }));
const { stub } = vi.hoisted(() => ({
  stub: (name: string) => (props: Record<string, never>) => {
    h.dialogs[name] = props as unknown as (typeof h.dialogs)[string];
    return <div role="dialog" aria-label={name} />;
  },
}));
vi.mock("./AgentsView/SqlToolEditor", () => ({ SqlToolEditor: stub("sql") }));
vi.mock("./AgentsView/LocalProgramDialog", () => ({ LocalProgramDialog: stub("program") }));
vi.mock("./AgentsView/SiteDialog", () => ({ SiteDialog: stub("site") }));

const WYSEBEE: ChatAgent = { id: "w", name: "wysebee", label: "Wysebee", avatar: "" };
const SCOUT: ChatAgent = { id: "s", name: "scout", label: "Scout", avatar: "", browser: true, device: "wysebee-browser-chrome" };
const MACKY: ChatAgent = { id: "m", name: "macky", label: "Macky", avatar: "", mac: true, device: "wysebee-osx" };

// The person's tools, and each agent's by id.
let library: api.Tool[] = [];
let held: Record<string, string[]> = {};
let configs: Record<string, Record<string, unknown>> = {};
let made = 0;

const plus = (name: string) => screen.getByRole("button", { name: `Give ${name} to an agent` });
const menu = () => screen.getByRole("menu");
const item = (label: string) => within(menu()).getByRole("menuitem", { name: new RegExp(`^${label}`) }) as HTMLButtonElement;
const tab = (name: string) => userEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: new RegExp(`^${name}`) }));

/** The page with its menu beside it, as App has them: Local File & Folder first, as the tabs were. */
function Tools({ initial = "local" }: { initial?: LibraryTab | null }) {
  const [shown, setShown] = useState<LibraryTab | null>(initial);
  const [library, setLibrary] = useState<api.Tool[] | null>(null);
  return (
    <>
      <ToolsNav library={library} selected={shown} onSelect={setShown} />
      <ToolsView tab={shown} onLibrary={setLibrary} />
    </>
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  // Wysebee Cloud's agent types, as the server seeds them: read before each test (the loading
  // state has its own).
  forgetAgentTypes();
  vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: TYPES });
  await loadAgentTypes();
  h.agents = [WYSEBEE, MACKY, SCOUT];
  h.load.mockReset();
  h.toast.mockReset();
  h.dialogs = {};
  library = [];
  held = { w: [], s: [], m: [] };
  configs = { w: {}, s: { browser_link: "l1", agent_type_id: "t-chrome", browser_access: false }, m: { mac_link: "m1", agent_type_id: "t-osx" } };
  made = 0;
  vi.spyOn(api, "fetchTools").mockImplementation(async () => ({ tools: [...library] }));
  vi.spyOn(api, "fetchAgentTools").mockImplementation(async (agent) => ({ tools: held[agent].map((id) => library.find((t) => t.id === id)!) }));
  vi.spyOn(api, "setAgentTools").mockImplementation(async (agent, kind, ids) => {
    held[agent] = [...held[agent].filter((id) => library.find((t) => t.id === id)!.kind !== kind), ...ids];
    return { tools: [] };
  });
  vi.spyOn(api, "createTool").mockImplementation(async (body) => {
    const t = tool(body.kind!, api.SITE_KINDS.includes(body.kind as api.SiteKind) ? String(body.config.address) : body.name, body.config, { id: `t${++made}`, description: body.description });
    library.push(t);
    return t;
  });
  vi.spyOn(api, "fetchAgentDetail").mockImplementation(async (id) => ({ id, agent_name: id, config: configs[id], system_prompt: "", creator: "", creator_name: "", updated_at: null }));
  vi.spyOn(api, "saveAgentConfig").mockImplementation(async (id, config) => {
    configs[id] = config;
    return { id, agent_name: id, config, system_prompt: "", creator: "", creator_name: "", updated_at: null };
  });
});

describe("ToolsView", () => {
  it("shows the library's kinds of tool in its tabs, each saying which agents may have it, then the person's own", async () => {
    render(<Tools />);
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map((t) => t.textContent)).toEqual(["All tools", "Local File & Folder", "Website", "Database"]);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByText("None of yours here yet. Make one with a + above.")).toBeTruthy();
    // Local Folder is picked on the computer: no +, and both are Mac and PC agents' only.
    expect(screen.getByText("On the computer")).toBeTruthy();
    expect(screen.getAllByText("Mac and PC agents")).toHaveLength(2);
    expect(plus("Run local program")).toBeTruthy();
    await tab("Website");
    expect(screen.getAllByText("Browser agents")).toHaveLength(7);
    expect(plus("Browser access")).toBeTruthy();
    expect(plus("Web development tools")).toBeTruthy();
    await tab("Database");
    // Any agent may have a SQL Query tool: no tag. Connections are not tools.
    expect(screen.queryByText(/agents$/)).toBeNull();
    expect(plus("SQL Query")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Give PostgreSQL to an agent" })).toBeNull();
    expect(h.load).not.toHaveBeenCalled();
  });

  it("shows every kind and every one of the person's tools under All tools, and counts each kind's in the menu", async () => {
    // A database connection is kept with them, but is no tool the page shows: not counted.
    library = [tool("program", "say"), tool("website", "https://a.example"), tool("sql", "Orders"), tool("postgres", "sales_db")];
    render(<Tools initial={null} />);
    const nav = within(screen.getByRole("navigation", { name: "Tools" }));
    expect(nav.getByRole("button", { name: "All tools" }).getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(nav.getAllByRole("button").map((b) => b.textContent)).toEqual(["All tools3", "Local File & Folder1", "Website1", "Database1"]));
    expect(screen.getByRole("region", { name: "All tools" })).toBeTruthy();
    // Every kind's templates, and all of the person's.
    for (const name of ["Run local program", "Browser access", "SQL Query"]) expect(plus(name)).toBeTruthy();
    for (const name of ["say", "https://a.example", "Orders"]) expect(plus(name)).toBeTruthy();
    await tab("Website");
    expect(screen.getByRole("region", { name: "Website" })).toBeTruthy();
    expect(nav.getByRole("button", { name: /^Website/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Give say to an agent" })).toBeNull();
    expect(plus("https://a.example")).toBeTruthy();
    await tab("All tools");
    expect(plus("say")).toBeTruthy();
  });

  it("reads the agents when the store has none yet, and says when there are none", async () => {
    h.agents = null;
    const { rerender } = render(<Tools />);
    expect(h.load).toHaveBeenCalled();
    await userEvent.click(plus("Run local program"));
    expect(within(menu()).getByText("No agents yet.")).toBeTruthy();
    h.agents = [];
    rerender(<Tools />);
    expect(within(menu()).getByText("No agents yet.")).toBeTruthy();
  });

  it("names other kinds of device by their types, and greys every agent until the types are read", async () => {
    // A phone's tool is listed for its type by name; so are kinds the page has no words for.
    forgetAgentTypes();
    vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: TYPES.map((t) => (t.kind === "osx" ? { ...t, tool_kinds: [...t.tool_kinds.filter((k) => k !== "folder")] } : t.kind === "android" ? { ...t, tool_kinds: ["android", "folder"] } : t)) });
    await loadAgentTypes();
    render(<Tools />);
    expect(await screen.findByText("Wysebee Android Agent")).toBeTruthy();
    cleanup();
    // Not read yet: no tag, and every agent greyed, saying so.
    forgetAgentTypes();
    let answer!: (r: { types: api.AgentType[] }) => void;
    vi.spyOn(api, "fetchAgentTypes").mockReturnValue(new Promise((r) => (answer = r)));
    render(<Tools />);
    await screen.findByText("None of yours here yet. Make one with a + above.");
    expect(screen.queryByText("Mac and PC agents")).toBeNull();
    await userEvent.click(plus("Run local program"));
    expect(item("Macky").disabled).toBe(true);
    expect(item("Macky").textContent).toContain("Reading which agents may have it…");
    await act(async () => answer({ types: TYPES }));
    expect(await screen.findAllByText("Mac and PC agents")).toHaveLength(2);
  });

  it("gives a Mac agent a new program from Run local program; an agent of another kind is greyed", async () => {
    library = [tool("program", "say", { command: "say", args: [] })];
    render(<Tools />);
    await screen.findByRole("heading", { name: "say" });
    await userEvent.click(plus("Run local program"));
    expect(menu().textContent).toContain("Add to…");
    expect(item("Wysebee").disabled).toBe(true);
    expect(item("Wysebee").textContent).toContain("Mac and PC agents only");
    expect(item("Scout").disabled).toBe(true);
    // Escape, a click outside, and the + again each close it; a click inside does not.
    fireEvent.keyDown(menu(), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(plus("Run local program"));
    fireEvent.mouseDown(menu());
    expect(menu()).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    // A click alone (a script's) closes it too; one on another card's + opens only that one.
    await userEvent.click(plus("Run local program"));
    fireEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(plus("Run local program"));
    await userEvent.click(plus("Run local program"));
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(plus("Run local program"));
    await userEvent.click(item("Macky"));
    await screen.findByRole("dialog", { name: "program" });
    // Its name must not be one of the person's other programs.
    expect(h.dialogs.program.others).toEqual([{ name: "say", description: "", command: "say", args: [] }]);
    act(() => void h.dialogs.program.onClose());
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(plus("Run local program"));
    await userEvent.click(item("Macky"));
    await screen.findByRole("dialog", { name: "program" });
    act(() => void h.dialogs.program.onSave({ name: "wc", description: "Count", command: "wc", args: [{ value: "-l" }] }));
    await waitFor(() => expect(held.m).toEqual(["t1"]));
    expect(api.createTool).toHaveBeenCalledWith({ kind: "program", name: "wc", description: "Count", config: { command: "wc", args: [{ value: "-l" }] } });
    expect(h.toast).toHaveBeenCalledWith("Gave wc to Macky.");
    // The library is read again: the new one is there.
    expect(await screen.findByRole("heading", { name: "wc" })).toBeTruthy();
  });

  it("gives one of the person's tools; an agent that has it is greyed", async () => {
    library = [tool("sql", "shop", {}, { description: "Orders" }), tool("postgres", "conn", {}, { description: "A connection" }), tool("news", "https://bbc.com/news", { address: "https://bbc.com/news" })];
    held.w = ["sql-shop"];
    render(<Tools />);
    await tab("Database");
    expect(await screen.findByText("Orders")).toBeTruthy();
    // A connection is not listed with the tools.
    expect(screen.queryByText("A connection")).toBeNull();
    await userEvent.click(plus("shop"));
    await waitFor(() => expect(item("Wysebee").disabled).toBe(true));
    expect(item("Wysebee").textContent).toContain("Has it");
    expect(item("Macky").disabled).toBe(false);
    await userEvent.click(item("Scout"));
    await waitFor(() => expect(held.s).toEqual(["sql-shop"]));
    expect(h.toast).toHaveBeenCalledWith("Gave shop to Scout.");
    // A refusal is said, and goes with the next that works.
    vi.mocked(api.setAgentTools).mockRejectedValueOnce(new Error("HTTP 422: An agent has at most 50 sql tools."));
    await userEvent.click(plus("shop"));
    await userEvent.click(item("Macky"));
    expect(await screen.findByText("An agent has at most 50 sql tools.")).toBeTruthy();
    await userEvent.click(plus("shop"));
    await userEvent.click(item("Macky"));
    await waitFor(() => expect(screen.queryByText("An agent has at most 50 sql tools.")).toBeNull());
    // A site link is a browser agent's only; a check that fails greys nothing.
    await tab("Website");
    vi.mocked(api.fetchAgentTools).mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(plus("https://bbc.com/news"));
    expect(item("Macky").textContent).toContain("Browser agents only");
    expect(item("Scout").disabled).toBe(false);
  });

  it("turns Browser access and the web development tools on in a browser agent's settings", async () => {
    render(<Tools />);
    await tab("Website");
    await userEvent.click(plus("Browser access"));
    expect(item("Wysebee").disabled).toBe(true);
    await waitFor(() => expect(api.fetchAgentDetail).toHaveBeenCalledWith("s"));
    expect(item("Scout").disabled).toBe(false);
    await userEvent.click(item("Scout"));
    await waitFor(() => expect(configs.s).toEqual({ browser_link: "l1", agent_type_id: "t-chrome", browser_access: true }));
    expect(h.toast).toHaveBeenCalledWith("Gave Browser access to Scout.");
    // It has Browser access now.
    await userEvent.click(plus("Browser access"));
    await waitFor(() => expect(item("Scout").textContent).toContain("Has it"));
    fireEvent.keyDown(menu(), { key: "Escape" });
    // The web development tools: not yet; then on, with Browser access.
    await userEvent.click(plus("Web development tools"));
    await waitFor(() => expect(api.fetchAgentDetail).toHaveBeenCalledTimes(4));
    expect(item("Scout").disabled).toBe(false);
    await userEvent.click(item("Scout"));
    await waitFor(() => expect(configs.s).toEqual({ browser_link: "l1", agent_type_id: "t-chrome", browser_access: true, browser_devtools: true }));
    await userEvent.click(plus("Web development tools"));
    await waitFor(() => expect(item("Scout").disabled).toBe(true));
    // Another card's + closes this menu: one is open at a time.
    await userEvent.click(plus("Browser access"));
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(screen.getByRole("menu", { name: "Give Browser access to an agent" })).toBeTruthy();
  });

  it("opens a site tool's dialog on the links the agent has, and gives it what is saved", async () => {
    library = [tool("news", "https://bbc.com/news", { address: "https://bbc.com/news" }, { description: "World" }), tool("gmail", "https://mail.google.com/", { address: "https://mail.google.com/" })];
    held.s = ["news-https://bbc.com/news", "gmail-https://mail.google.com/"];
    render(<Tools />);
    await tab("Website");
    await userEvent.click(plus("News"));
    await userEvent.click(item("Scout"));
    await screen.findByRole("dialog", { name: "site" });
    expect(h.dialogs.site.kind).toBe("news");
    expect(h.dialogs.site.initial).toEqual([{ description: "World", address: "https://bbc.com/news" }]);
    act(() => void h.dialogs.site.onClose());
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(plus("News"));
    await userEvent.click(item("Scout"));
    await screen.findByRole("dialog", { name: "site" });
    act(() => void h.dialogs.site.onSave([{ description: "World", address: "https://bbc.com/news" }, { description: "Tech", address: "https://theverge.com/" }]));
    await waitFor(() => expect(held.s).toEqual(["gmail-https://mail.google.com/", "news-https://bbc.com/news", "t1"]));
    expect(h.toast).toHaveBeenCalledWith("Gave News to Scout.");
  });

  it("opens a SQL tool's page for the agent picked, on its connections, and gives it what is made", async () => {
    library = [tool("sql", "count"), tool("postgres", "shop")];
    held.m = ["postgres-shop"];
    render(<Tools />);
    await tab("Database");
    await screen.findByRole("heading", { name: "count" });
    await userEvent.click(plus("SQL Query"));
    await userEvent.click(item("Macky"));
    await screen.findByRole("dialog", { name: "sql" });
    expect(h.dialogs.sql.others).toEqual(["count"]);
    expect(h.dialogs.sql.connections).toEqual([library[1]]);
    await act(async () => {
      await h.dialogs.sql.onSave({ id: "x", name: "orders", description: "Orders.", connectionId: "postgres-shop", params: [], sql: "SELECT 1" }, true);
    });
    expect(held.m).toEqual(["postgres-shop", "t1"]);
    expect(vi.mocked(api.createTool).mock.calls[0][0]).toMatchObject({ kind: "sql", id: "x", name: "orders" });
    expect(h.toast).toHaveBeenCalledWith("Gave orders to Macky.");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Connecting first opens the agent's General tab; Back closes the page.
    await userEvent.click(plus("SQL Query"));
    await userEvent.click(item("Wysebee"));
    await screen.findByRole("dialog", { name: "sql" });
    expect(h.dialogs.sql.connections).toEqual([]);
    act(() => void h.dialogs.sql.onConnect());
    expect(window.location.hash).toBe("#/agents/w/property");
    act(() => void h.dialogs.sql.onBack());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says why the tools could not be read", async () => {
    vi.mocked(api.fetchTools).mockRejectedValue(new Error("HTTP 503: Wysebee Cloud is busy."));
    render(<Tools />);
    expect(await screen.findByText("Wysebee Cloud is busy.")).toBeTruthy();
    // A tool made meanwhile: none of the person's names known to keep it from.
    await tab("Database");
    await userEvent.click(plus("SQL Query"));
    await userEvent.click(item("Wysebee"));
    await screen.findByRole("dialog", { name: "sql" });
    expect(h.dialogs.sql.others).toEqual([]);
  });
});
