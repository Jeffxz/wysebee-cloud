import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import * as api from "../../api";
import { TYPES } from "../../../../test/agentTypes";
import { forgetAgentTypes, loadAgentTypes } from "../../agentTypes";
import { tool } from "../../../../test/tools";
import { ToolCards } from "./ToolCards";
import { dialogs } from "../common/confirm";

const link = (over: Partial<api.BrowserLink> = {}): api.BrowserLink => ({
  id: "l1",
  agent: "scout",
  label: "Scout",
  browser: "Chrome",
  extension_version: "0.2.0",
  status: "connected",
  paused: false,
  last_seen: null,
  created_at: "",
  ...over,
});

// The person's tools and the agent's (by id), as Wysebee Cloud keeps them.
let library: api.Tool[] = [];
let mine: string[] = [];
let made = 0;
/** The agent has these tools (in the person's library too). */
const have = (...tools: api.Tool[]) => {
  library.push(...tools);
  mine.push(...tools.map((t) => t.id));
};
const SITE_KINDS: readonly string[] = api.SITE_KINDS;
const kept = (kind: api.ToolKind, body: api.ToolIn, id: string): api.Tool =>
  tool(kind, SITE_KINDS.includes(kind) ? String(body.config.address) : body.name, body.config, { id, description: body.description });

const program = (p: { name: string; description: string; command: string; args: unknown[] }) => tool("program", p.name, { command: p.command, args: p.args }, { description: p.description });

const onConnect = vi.fn();
const onInstructions = vi.fn();
function setup(config: Record<string, unknown>, more: { canEdit?: boolean } = {}) {
  const onChange = vi.fn();
  const utils = render(<ToolCards config={config} onChange={onChange} canEdit={more.canEdit ?? true} agentId="sky" onConnect={onConnect} onInstructions={onInstructions} />);
  return { onChange, ...utils };
}
const tabs = () => screen.getAllByRole("tab").map((t) => t.textContent);
const openLibrary = () => userEvent.click(screen.getByRole("tab", { name: "Tool library" }));
/** The proposals panel, opened from its button beside the tab's sections. */
const proposals = async () => {
  await userEvent.click(await screen.findByRole("button", { name: /proposals? from your AI app/i }));
  return screen.getByRole("dialog", { name: "Proposed by your AI app" });
};
const row = (title: string) => screen.getByRole("heading", { name: title }).closest("div.rounded-xl") as HTMLElement;

beforeEach(async () => {
  vi.restoreAllMocks();
  // Wysebee Cloud's agent types, as the server seeds them: read before each test (the loading
  // state has its own).
  forgetAgentTypes();
  vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: TYPES });
  await loadAgentTypes();
  library = [];
  mine = [];
  made = 0;
  vi.spyOn(api, "fetchTools").mockImplementation(async () => ({ tools: [...library] }));
  vi.spyOn(api, "fetchAgentTools").mockImplementation(async () => ({ tools: mine.map((id) => library.find((t) => t.id === id)!) }));
  vi.spyOn(api, "setAgentTools").mockImplementation(async (_agent, kind, ids) => {
    mine = [...mine.filter((id) => library.find((t) => t.id === id)!.kind !== kind), ...ids];
    return { tools: [] };
  });
  vi.spyOn(api, "createTool").mockImplementation(async (body) => {
    const t = kept(body.kind!, body, `t${++made}`);
    library.push(t);
    return t;
  });
  vi.spyOn(api, "updateTool").mockImplementation(async (id, body) => {
    const t = kept(library.find((x) => x.id === id)!.kind, body, id);
    library = library.map((x) => (x.id === id ? t : x));
    return t;
  });
  vi.spyOn(api, "fetchBrowserLinks").mockResolvedValue({ links: [link(), link({ id: "m1", kind: "osx", browser: "Kim's Mac", approved: ["say"] })] });
});

describe("ToolCards on the web", () => {
  it("lays an agent with no home out as Wysebee Desktop does: Installed tools, then a library of what it may add", async () => {
    setup({});
    // It opens on Installed tools, empty, which says how to add one.
    expect(tabs()).toEqual(["Installed tools0", "Tool library"]);
    expect(screen.getByText("No tools yet. Add one from the Tool library.")).toBeTruthy();
    await openLibrary();
    // Only the Database tab: the local tools are a Mac agent's, the website's a browser agent's.
    expect(tabs()).toEqual(["Installed tools0", "Tool library", "Database"]);
    // A SQL Query tool is added here (its connections are on the General tab).
    await waitFor(() => expect((screen.getByRole("button", { name: "Add SQL Query" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "Add PostgreSQL" })).toBeNull();
    expect(api.fetchAgentTools).toHaveBeenCalledWith("sky");
    expect(api.fetchBrowserLinks).not.toHaveBeenCalled();
    // Without edit rights: what it has.
    have(tool("sql", "count_orders", { connection_id: "c1", params: [], sql: "SELECT 1" }, { description: "Counts." }));
    setup({}, { canEdit: false });
    expect(await screen.findByRole("heading", { name: "count_orders" })).toBeTruthy();
  });

  it("shows only what an agent has, without edit rights", () => {
    setup({ home: "pc1" }, { canEdit: false });
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByText("No tools yet.")).toBeTruthy();
  });

  it("shows a site tool's line as text, not a button, without edit rights", async () => {
    have(tool("news", "https://bbc.com/news", { address: "https://bbc.com/news" }, { description: "World" }));
    setup({ browser_link: "l1", agent_type_id: "t-chrome" }, { canEdit: false });
    expect((await screen.findByText("1 site")).tagName).toBe("P");
    expect(within(row("News")).queryByRole("button")).toBeNull();
  });

  it("gives an agent paired with a browser its browser's tools and the site tools", async () => {
    have(tool("news", "https://bbc.com/news", { address: "https://bbc.com/news" }, { description: "World" }));
    const { onChange, rerender } = setup({ browser_link: "l1", agent_type_id: "t-chrome", browser_access: true });
    // Installed: Browser access, saying which browser and whether it is connected, and News.
    expect(await within(row("Browser access")).findByText("Paired with Chrome · Connected")).toBeTruthy();
    expect(await within(row("News")).findByText("1 site")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Browser access" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ browser_access: false, browser_devtools: false }));
    await userEvent.click(screen.getByRole("button", { name: "Change News" }));
    expect(screen.getByRole("dialog", { name: "Change your news sites" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    // Taken from the agent at once (it stays the person's).
    await userEvent.click(screen.getByRole("button", { name: "Remove News" }));
    await waitFor(() => expect(api.setAgentTools).toHaveBeenLastCalledWith("sky", "news", []));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "News" })).toBeNull());
    // The library's Website tab: the web development tools, the site tools not set up, and the
    // person's own links this agent does not have.
    await openLibrary();
    expect(tabs()).toEqual(["Installed tools1", "Tool library", "Website", "Database"]);
    await userEvent.click(screen.getByRole("tab", { name: "Website" }));
    expect(screen.queryByRole("button", { name: "Add Browser access" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Give this agent https://bbc.com/news" }));
    await waitFor(() => expect(mine).toEqual(["news-https://bbc.com/news"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add News" })).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Add Web development tools" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ browser_access: true, browser_devtools: true }));
    await userEvent.click(screen.getByRole("button", { name: "Add Open Gmail" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    // Browser access off: offered again, and the web development tools say they bring it.
    rerender(<ToolCards config={{ browser_link: "l1", agent_type_id: "t-chrome", browser_access: false }} onChange={onChange} canEdit agentId="sky" onConnect={onConnect} onInstructions={onInstructions} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Browser access" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ browser_access: true }));
    expect(screen.getByRole("button", { name: "Add Web development tools" }).getAttribute("title")).toMatch(/Browser access/);
    // On: the web development tools are installed, with their trash.
    rerender(<ToolCards config={{ browser_link: "l1", agent_type_id: "t-chrome", browser_devtools: true }} onChange={onChange} canEdit agentId="sky" onConnect={onConnect} onInstructions={onInstructions} />);
    await userEvent.click(screen.getByRole("tab", { name: /^Installed tools/ }));
    await userEvent.click(screen.getByRole("button", { name: "Remove Web development tools" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ browser_devtools: false }));
  });

  it("saves a site tool's links from its dialog as the person's tools, given to the agent", async () => {
    // One link the person has already, under another description: the same tool, changed.
    library.push(tool("gmail", "https://mail.google.com/mail/u/1/", { address: "https://mail.google.com/mail/u/1/" }, { description: "Old" }));
    library.push(tool("gmail", "https://mail.google.com/mail/u/2/", { address: "https://mail.google.com/mail/u/2/" }, { description: "Same" }));
    const { onChange } = setup({ browser_link: "l1", agent_type_id: "t-chrome" });
    await openLibrary();
    await userEvent.click(screen.getByRole("tab", { name: "Website" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Add Open Gmail" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Add Open Gmail" }));
    await userEvent.type(screen.getByLabelText("Link"), "https://mail.google.com/mail/u/0/");
    await userEvent.type(screen.getByLabelText("What it is for"), "Work mail");
    for (const [address, description] of [["https://mail.google.com/mail/u/1/", "Home mail"], ["https://mail.google.com/mail/u/2/", "Same"]] as const) {
      await userEvent.click(screen.getByRole("button", { name: "Add another Gmail" }));
      const links = screen.getAllByLabelText("Link");
      await userEvent.type(links[links.length - 1], address);
      const what = screen.getAllByLabelText("What it is for");
      await userEvent.type(what[what.length - 1], description);
    }
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(api.setAgentTools).toHaveBeenLastCalledWith("sky", "gmail", ["t1", "gmail-https://mail.google.com/mail/u/1/", "gmail-https://mail.google.com/mail/u/2/"]));
    expect(api.createTool).toHaveBeenCalledWith({ kind: "gmail", name: "https://mail.google.com/mail/u/0/", description: "Work mail", config: { address: "https://mail.google.com/mail/u/0/" } });
    expect(api.updateTool).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives an agent paired with a Mac its programs and folders", async () => {
    have(program({ name: "say", description: "Speak", command: "/usr/bin/say", args: [{ value: "-v" }, { param: "text" }] }), program({ name: "wc", description: "Count", command: "/usr/bin/wc", args: [] }));
    setup(
      {
        mac_link: "m1", agent_type_id: "t-osx",
        mac_folders: [{ id: "f1", name: "Notes", path: "/Users/me/Notes", mode: "write", description: "My notes" }],
      },
    );
    // Allowed on the computer or still waiting, as its link says.
    await screen.findByRole("heading", { name: "say" });
    expect(await within(row("say")).findByText("Allowed on the computer")).toBeTruthy();
    expect(within(row("wc")).getByText(/Waiting for you to allow it/)).toBeTruthy();
    expect(within(row("say")).getByText("/usr/bin/say -v <text>")).toBeTruthy();
    expect(screen.getByText(/Kim's Mac/)).toBeTruthy();
    expect(within(row("Local Folder")).getByText("Notes")).toBeTruthy();
    expect(within(row("Local Folder")).getByText("My notes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change say" })).toBeTruthy();
    await openLibrary();
    // Local File & Folder: Run local program, added here (2026-11-13); its folders are shared.
    expect(tabs()).toEqual(["Installed tools3", "Tool library", "Local File & Folder", "Database"]);
    expect(screen.getByRole("button", { name: "Add Run local program" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Local Folder" })).toBeNull();
  });

  it("offers a Windows PC's agent ready-made Windows tools, each looked at before it is added", async () => {
    // One of them is among the person's programs already (another agent's): not offered again.
    library.push(program({ name: "ping_host", description: "Ping", command: "ping", args: [] }));
    setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows" });
    await openLibrary();
    expect(await screen.findByRole("heading", { name: "system_info" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "open_settings" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { name: "ping_host" })).toHaveLength(1);
    // Added: the dialog opens filled in, and saves it as a new program tool given to the agent.
    await userEvent.click(screen.getByRole("button", { name: "Give this agent system_info" }));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Program") as HTMLInputElement).value).toBe("systeminfo");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(api.createTool).toHaveBeenCalledWith(expect.objectContaining({ kind: "program", name: "system_info", config: { command: "systeminfo", args: [{ value: "/FO" }, { value: "LIST" }] } })));
    await waitFor(() => expect(mine).toContain("t1"));
    // Run local program still starts empty.
    await userEvent.click(screen.getByRole("tab", { name: "Tool library" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add Run local program" }));
    expect((within(screen.getByRole("dialog")).getByLabelText("Program") as HTMLInputElement).value).toBe("");
  });

  it("offers a Linux machine's agent its packs in its words, but no screen, iPhones or Windows tools", async () => {
    const { onChange } = setup({ mac_link: "m1", agent_type_id: "t-linux", paired_kind: "wysebee-linux", run_any_program: true });
    expect(await screen.findByRole("heading", { name: "Run any program" })).toBeTruthy();
    expect(screen.getByText("Let Wysebee run any program on this Linux machine that it names")).toBeTruthy();
    await openLibrary();
    expect(await screen.findByRole("button", { name: "Add Run local program" })).toBeTruthy();
    expect(screen.getByText("Let Wysebee work on this Linux machine as a coding assistant would")).toBeTruthy();
    expect(screen.getByText("Let Wysebee use the Android phones plugged in to this Linux machine, through adb")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Screen control" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add iPhone Development Toolkit" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "system_info" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Add Developer access" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-linux", paired_kind: "wysebee-linux", run_any_program: true, developer_access: true });
  });

  it("offers a Linux machine's agent only the person's programs it can run", async () => {
    library.push(program({ name: "system_info", description: "Windows info", command: "systeminfo", args: [] }));
    library.push(program({ name: "open_settings", description: "Settings", command: "explorer", args: [{ value: "ms-settings:" }] }));
    library.push(program({ name: "who", description: "Who", command: "whoami", args: [] }));
    library.push(program({ name: "say", description: "Speak", command: "/usr/bin/say", args: [] }));
    // One saved without a command names no system, so any computer is offered it.
    library.push(tool("program", "no_command", { args: [] }, { description: "No command" }));
    const { unmount } = setup({ mac_link: "m1", agent_type_id: "t-linux", paired_kind: "wysebee-linux" });
    await openLibrary();
    expect(await screen.findByRole("heading", { name: "who" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "no_command" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "say" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "system_info" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "open_settings" })).toBeNull();
    unmount();
    // A Windows PC's agent: its own, not a path from /.
    setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows" });
    await openLibrary();
    expect(await screen.findByRole("button", { name: "Give this agent system_info" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give this agent who" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "say" })).toBeNull();
  });

  it("offers a Mac's agent no ready-made Windows tools, but Run any program in a Mac's words", async () => {
    setup({ mac_link: "m1", agent_type_id: "t-osx", paired_kind: "wysebee-osx", run_any_program: true });
    expect(await screen.findByRole("heading", { name: "Run any program" })).toBeTruthy();
    expect(screen.getByText("Let Wysebee run any program on this Mac that it names")).toBeTruthy();
    await openLibrary();
    expect(await screen.findByRole("button", { name: "Add Run local program" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "system_info" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Run any program" })).toBeNull();
  });

  it("gives a Windows PC's agent Run any program, and takes it away", async () => {
    const { onChange, unmount } = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows" });
    await openLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Add Run any program" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", run_any_program: true });
    unmount();
    const given = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", run_any_program: true });
    expect(await screen.findByRole("heading", { name: "Run any program" })).toBeTruthy();
    expect(screen.getByText(/Let Wysebee run any program on this Windows PC/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Run any program" }));
    expect(given.onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", run_any_program: false });
    await openLibrary();
    expect(screen.queryByRole("button", { name: "Add Run any program" })).toBeNull();
  });

  it("gives a Windows PC's agent Developer access and the Android toolkit, and takes them away; a Mac's too, in its words", async () => {
    const { onChange, unmount } = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows" });
    await openLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Add Developer access" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", developer_access: true });
    await userEvent.click(screen.getByRole("button", { name: "Add Android Development Toolkit" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", android_toolkit: true });
    unmount();
    const given = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", developer_access: true, android_toolkit: true });
    expect(await screen.findByRole("heading", { name: "Developer access" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Android Development Toolkit" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Android Development Toolkit" }));
    expect(given.onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", developer_access: true, android_toolkit: false });
    await openLibrary();
    expect(screen.queryByRole("button", { name: "Add Developer access" })).toBeNull();
    // Never the iPhone toolkit: Xcode is a Mac's.
    expect(screen.queryByRole("button", { name: "Add iPhone Development Toolkit" })).toBeNull();
    given.unmount();
    setup({ mac_link: "m1", agent_type_id: "t-osx", paired_kind: "wysebee-osx", developer_access: true });
    expect(await screen.findByRole("heading", { name: "Developer access" })).toBeTruthy();
    expect(screen.getByText("Let Wysebee work on this Mac as a coding assistant would")).toBeTruthy();
    await openLibrary();
    expect(await screen.findByText("Let Wysebee use the Android phones plugged in to this Mac, through adb")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Android Development Toolkit" })).toBeTruthy();
  });

  it("gives a Mac's agent the iPhone Development Toolkit, and takes it away", async () => {
    // A Mac's agent (its type named by the pairing).
    const { onChange, unmount } = setup({ mac_link: "m1", agent_type_id: "t-osx" });
    await openLibrary();
    expect(await screen.findByText("Let Wysebee use this Mac's iOS simulators and paired iPhones, through Xcode")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add iPhone Development Toolkit" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-osx", ios_toolkit: true });
    unmount();
    const given = setup({ mac_link: "m1", agent_type_id: "t-osx", paired_kind: "wysebee-osx", ios_toolkit: true });
    expect(await screen.findByRole("heading", { name: "iPhone Development Toolkit" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove iPhone Development Toolkit" }));
    expect(given.onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-osx", paired_kind: "wysebee-osx", ios_toolkit: false });
    given.unmount();
    // A Windows PC's agent that somehow has it: not shown.
    setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", ios_toolkit: true });
    expect(await screen.findByText(/No tools yet|Add tools/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "iPhone Development Toolkit" })).toBeNull();
  });

  it("gives a Windows PC's agent Screen control, and takes it away; a Mac's too, in its words", async () => {
    const { onChange, unmount } = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows" });
    await openLibrary();
    await userEvent.click(await screen.findByRole("button", { name: "Add Screen control" }));
    expect(onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", screen_control: true });
    unmount();
    const given = setup({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", screen_control: true });
    expect(await screen.findByRole("heading", { name: "Screen control" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Screen control" }));
    expect(given.onChange).toHaveBeenLastCalledWith({ mac_link: "m1", agent_type_id: "t-windows", paired_kind: "wysebee-windows", screen_control: false });
    await openLibrary();
    expect(screen.queryByRole("button", { name: "Add Screen control" })).toBeNull();
    given.unmount();
    setup({ mac_link: "m1", agent_type_id: "t-osx", paired_kind: "wysebee-osx", screen_control: true });
    expect(await screen.findByRole("heading", { name: "Screen control" })).toBeTruthy();
    expect(screen.getByText("Let Wysebee see this Mac's screen and use its mouse and keyboard")).toBeTruthy();
    await openLibrary();
    expect(screen.queryByRole("button", { name: "Add Screen control" })).toBeNull();
  });

  it("makes, changes, takes away and gives a Mac agent's programs, saved at once as the person's tools", async () => {
    const say = { name: "say", description: "Speak", command: "/usr/bin/say", args: [{ value: "-v" }, { param: "text", description: "What to say" }] };
    const wc = { name: "wc", description: "Count", command: "/usr/bin/wc", args: [] };
    have(program(say), program(wc));
    const { onChange, unmount } = setup({ mac_link: "m1", agent_type_id: "t-osx" });
    // Changed: its pencil (or its line) opens the dialog with it, blanks' descriptions kept.
    await userEvent.click(await within(await screen.findByRole("heading", { name: "say" }).then((h) => h.closest("div.rounded-xl") as HTMLElement)).findByRole("button", { name: "Speak" }));
    const dialog = screen.getByRole("dialog", { name: "Change the local program tool" });
    expect((within(dialog).getByLabelText("What Wysebee should put here") as HTMLInputElement).value).toBe("What to say");
    await userEvent.clear(within(dialog).getByLabelText("What it does"));
    await userEvent.type(within(dialog).getByLabelText("What it does"), "Speak aloud");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("program-say", { name: "say", description: "Speak aloud", config: { command: say.command, args: say.args } }));
    // Taken away: the tool stays the person's, in the library.
    await userEvent.click(screen.getByRole("button", { name: "Remove wc" }));
    await waitFor(() => expect(mine).toEqual(["program-say"]));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "wc" })).toBeNull());
    // Made from the library; a name another of the person's programs has is refused first.
    await openLibrary();
    await userEvent.click(screen.getByRole("button", { name: "Add Run local program" }));
    const made = screen.getByRole("dialog", { name: "New local program tool" });
    await userEvent.type(within(made).getByLabelText("Tool name"), "wc");
    await userEvent.type(within(made).getByLabelText("What it does"), "Opens Postman");
    await userEvent.type(within(made).getByLabelText("Program"), "open /Applications/Postman.app");
    await userEvent.click(within(made).getByRole("button", { name: "Add tool" }));
    expect(within(made).getByText("There is already a tool named wc.")).toBeTruthy();
    await userEvent.clear(within(made).getByLabelText("Tool name"));
    await userEvent.type(within(made).getByLabelText("Tool name"), "open_postman");
    // A whole command line: split into the program and its arguments.
    await userEvent.click(within(made).getByRole("button", { name: "Split into program and arguments" }));
    expect((within(made).getByLabelText("Program") as HTMLInputElement).value).toBe("open");
    expect(within(made).getByLabelText("What runs").textContent).toBe("open /Applications/Postman.app");
    await userEvent.click(within(made).getByRole("button", { name: "Add tool" }));
    await waitFor(() => expect(mine).toEqual(["program-say", "t1"]));
    expect(api.createTool).toHaveBeenCalledWith({ kind: "program", name: "open_postman", description: "Opens Postman", config: { command: "open", args: [{ value: "/Applications/Postman.app" }] } });
    // The one taken away, given again from the library.
    await userEvent.click(await screen.findByRole("button", { name: "Give this agent wc" }));
    await waitFor(() => expect(mine).toEqual(["program-say", "t1", "program-wc"]));
    // Cancel closes without a change.
    await userEvent.click(screen.getByRole("button", { name: "Add Run local program" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    unmount();
    // Twenty is the most: no + then, nor a give.
    library = [];
    mine = [];
    have(...Array.from({ length: 20 }, (_, i) => program({ ...wc, name: `p${i}` })));
    library.push(program(say));
    setup({ mac_link: "m1", agent_type_id: "t-osx" });
    await openLibrary();
    await waitFor(() => expect((screen.getByRole("button", { name: "Add Run local program" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Give this agent say" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says why a change to the agent's tools was refused", async () => {
    have(program({ name: "say", description: "Speak", command: "say", args: [] }));
    vi.mocked(api.setAgentTools).mockRejectedValue(new Error("HTTP 422: Only an agent made by pairing Wysebee Agent for Mac can have Run local program."));
    // A Mac whose link is not in the account's list (yet): where its programs run is not said.
    setup({ mac_link: "m9", agent_type_id: "t-osx" });
    await userEvent.click(await screen.findByRole("button", { name: "Remove say" }));
    expect(screen.getByText("Runs on the computer paired with this agent")).toBeTruthy();
    expect(await screen.findByText(/Only an agent made by pairing Wysebee Agent for Mac/)).toBeTruthy();
  });

  it("shows a Mac agent's programs and folders as text without edit rights", async () => {
    have(program({ name: "say", description: "Speak", command: "say", args: [] }));
    setup({ mac_link: "m1", agent_type_id: "t-osx", mac_folders: [{ id: "f1", name: "Notes", path: "/n", mode: "read" }] }, { canEdit: false });
    expect((await screen.findByText("Speak")).tagName).toBe("P");
    expect(screen.queryByRole("button", { name: "Change say" })).toBeNull();
    expect(within(row("Local Folder")).getByText("Notes")).toBeTruthy();
  });

  it("offers a Mac agent with no folders where they are added", async () => {
    setup({ mac_link: "m1", agent_type_id: "t-osx" });
    await openLibrary();
    expect(within(row("Local Folder")).getByText("On the computer")).toBeTruthy();
  });

  it("says a paused browser or Mac, and folders as the Mac reports them", async () => {
    vi.mocked(api.fetchBrowserLinks).mockResolvedValue({
      links: [
        link({ paused: true }),
        link({ id: "m1", kind: "osx", browser: "Kim's Mac", paused: true, folders: [{ id: "f2", name: "Inbox", path: "/Users/me/Inbox", mode: "read", description: "" }, { id: "", name: "No id", path: "/Users/me/Elsewhere", mode: "read", description: "" }] }),
      ],
    });
    const { unmount } = setup({ browser_link: "l1", agent_type_id: "t-chrome" });
    expect(await within(row("Browser access")).findByText("Paired with Chrome · Paused in the extension")).toBeTruthy();
    unmount();
    // The Mac's own list wins over the stored one; a link that says nothing allowed allows nothing.
    have(program({ name: "say", description: "Speak", command: "say", args: [] }));
    setup(
      { mac_link: "m1", agent_type_id: "t-osx", mac_folders: [{ id: "f1", name: "Old", path: "/old", mode: "write", description: "" }] },
    );
    expect(await screen.findByText("Runs on Kim's Mac · Paused in Wysebee Agent")).toBeTruthy();
    expect(within(row("say")).getByText(/Waiting for you to allow it/)).toBeTruthy();
    const folder = row("Local Folder");
    expect(within(folder).getByText("Inbox")).toBeTruthy();
    expect(within(folder).getAllByText(/Read only/)).toHaveLength(2);
    expect(within(folder).queryByText("Old")).toBeNull();
    // One the Mac sent with no id is still listed, keyed by its path.
    expect(within(folder).getByText("/Users/me/Elsewhere")).toBeTruthy();
  });

  it("opens a site tool from its line, and says when a tab has nothing left to add; connections are not tools", async () => {
    have(
      tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me", ssl: "require" }, { has_secret: true }),
      ...api.SITE_KINDS.map((k) => tool(k, "https://mail.google.com/x", { address: "https://mail.google.com/x" }, { description: "One" })),
    );
    setup({ browser_link: "l1", agent_type_id: "t-chrome", browser_devtools: true });
    await screen.findByRole("heading", { name: "Travel" });
    await userEvent.click(within(row("Travel")).getByRole("button", { name: "1 site" }));
    expect(screen.getByRole("dialog", { name: "Change your travel sites" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    // The agent's connection is on its General tab, not here.
    expect(screen.queryByRole("heading", { name: "shop" })).toBeNull();
    // Browser access, the web development tools and every site tool are in: nothing left there.
    await openLibrary();
    await userEvent.click(screen.getByRole("tab", { name: "Website" }));
    expect(screen.getByText("Everything here is added.")).toBeTruthy();
  });

  it("asks for a connection before a SQL Query tool, then makes, changes and removes one", async () => {
    setup({});
    await openLibrary();
    await waitFor(() => expect((screen.getByRole("button", { name: "Add SQL Query" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Add SQL Query" }));
    // No database connected: one first, on the General tab.
    expect(screen.getByText("Connect a database first")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Connect a database" }));
    expect(onConnect).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    cleanup();
    have(tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me" }));
    setup({});
    await openLibrary();
    await waitFor(() => expect((screen.getByRole("button", { name: "Add SQL Query" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Add SQL Query" }));
    // Its only connection is picked.
    expect((screen.getByLabelText("Database connection") as HTMLSelectElement).value).toBe("postgres-shop");
    await userEvent.type(screen.getByLabelText("Name"), "count_orders");
    await userEvent.type(screen.getByLabelText("Description"), "Counts the orders.");
    fireEvent.change(screen.getByLabelText("SQL template"), { target: { value: "SELECT count(*) FROM orders" } });
    await userEvent.click(screen.getByRole("button", { name: "Create tool" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Create tool" })).toBeNull());
    const body = vi.mocked(api.createTool).mock.calls[0][0];
    expect(body).toMatchObject({ kind: "sql", name: "count_orders", config: { connection_id: "postgres-shop", params: [], sql: "SELECT count(*) FROM orders" } });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mine).toContain("t1");
    // Installed: on its connection; changed from its line; removed.
    await userEvent.click(screen.getByRole("tab", { name: /^Installed tools/ }));
    expect(await screen.findByText("On shop")).toBeTruthy();
    await userEvent.click(within(row("count_orders")).getByRole("button", { name: "Counts the orders." }));
    expect(screen.getByRole("heading", { name: "Edit count_orders" })).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "orders");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("t1", expect.objectContaining({ name: "orders" })));
    expect(await screen.findByRole("heading", { name: "orders" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove orders" }));
    await waitFor(() => expect(mine).not.toContain("t1"));
  });

  it("lists what the AI app proposed apart, reviews a SQL draft, creates a link or program as shown, or discards it", async () => {
    have(
      tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me" }),
      tool("sql", "count_orders", { connection_id: "postgres-shop", params: [], sql: "SELECT 1", draft: true }, { id: "d1", description: "Counts." }),
      tool("sql", "wipe", { connection_id: "postgres-shop", params: [], sql: "DELETE FROM orders", draft: true }, { id: "d2", description: "Wipes." }),
      tool("news", "https://bbc.com/news", { address: "https://bbc.com/news", draft: true }, { id: "d3", description: "World news." }),
      tool("program", "say", { command: "/usr/bin/say", args: [{ value: "-v" }, { param: "text", description: "What." }], draft: true }, { id: "d4", description: "Speaks." }),
      tool("news", "https://ft.com", { address: "https://ft.com" }, { id: "n1", description: "Money." }),
    );
    const drop = vi.spyOn(api, "deleteTool").mockImplementation(async (id) => {
      library = library.filter((x) => x.id !== id);
      mine = mine.filter((x) => x !== id);
    });
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    setup({ browser_link: "l1", agent_type_id: "t-chrome" });
    const panel = await proposals();
    expect(within(panel).getAllByText("SQL Query tool")).toHaveLength(2);
    expect(within(panel).getByText("News link")).toBeTruthy();
    expect(within(panel).getByText("/usr/bin/say -v <text>")).toBeTruthy();
    expect(within(panel).getByText(/asks you again before it runs/)).toBeTruthy();
    // Not among what the agent has: one news site, its own.
    expect(await screen.findByText("1 site")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "count_orders" })).toBeNull();
    // A link is created as it is: saved without `draft`.
    await userEvent.click(within(panel).getByRole("button", { name: "Create https://bbc.com/news" }));
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("d3", { name: "https://bbc.com/news", description: "World news.", config: { address: "https://bbc.com/news" } }));
    // Giving a kind's tools keeps its drafts given.
    await userEvent.click(screen.getByRole("button", { name: "Remove News" }));
    await waitFor(() => expect(api.setAgentTools).toHaveBeenCalledWith("sky", "news", []));
    vi.mocked(api.setAgentTools).mockClear();
    // A draft discarded once asked: deleted.
    await userEvent.click(within(panel).getByRole("button", { name: "Discard wipe" }));
    expect(drop).not.toHaveBeenCalled();
    await userEvent.click(within(panel).getByRole("button", { name: "Discard wipe" }));
    await waitFor(() => expect(drop).toHaveBeenCalledWith("d2"));
    expect(confirm).toHaveBeenCalledWith("Discard the draft 'wipe'? It is deleted.", expect.anything());
    // A SQL draft opens in its editor, created there.
    await userEvent.click(within(screen.queryByRole("dialog") ?? (await proposals())).getByRole("button", { name: "Review count_orders" }));
    expect(screen.getByRole("heading", { name: "Review draft count_orders" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create tool" }));
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("d1", expect.objectContaining({ kind: "sql", name: "count_orders" })));
  });

  it("keeps the proposals in a panel from the right: one says so, Escape or a click beside it closes it, and it goes with the last", async () => {
    have(tool("news", "https://bbc.com/news", { address: "https://bbc.com/news", draft: true }, { id: "d3", description: "World news." }));
    setup({ browser_link: "l1", agent_type_id: "t-chrome" });
    expect(await screen.findByRole("button", { name: /^1 proposal from your AI app/ })).toBeTruthy();
    let panel = await proposals();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    panel = await proposals();
    // A click inside keeps it; beside it closes it.
    fireEvent.click(panel);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(panel.parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The last one created: the panel and its button go.
    panel = await proposals();
    await userEvent.click(within(panel).getByRole("button", { name: "Create https://bbc.com/news" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: /proposals? from your AI app/i })).toBeNull();
  });

  it("gives a skill the AI app asked for, or declines it", async () => {
    const ask = { skill_id: "k1", name: "forecast", description: "Weather.", reason: "For weather questions.", created_at: "" };
    const fetched = vi.spyOn(api, "fetchSkillRequests").mockResolvedValue({ requests: [ask, { ...ask, skill_id: "k2", name: "tides", reason: "" }] });
    const give = vi.spyOn(api, "giveRequestedSkill").mockResolvedValue({ skills: [] });
    const decline = vi.spyOn(api, "declineSkillRequest").mockResolvedValue();
    setup({});
    const panel = await proposals();
    expect(within(panel).getAllByText("Skill")).toHaveLength(2);
    expect(within(panel).getByText("Why: For weather questions.")).toBeTruthy();
    expect(within(panel).getAllByRole("link", { name: "See its files on the Skills page first" })[0].getAttribute("href")).toBe("#/skills/k1");
    fetched.mockResolvedValue({ requests: [{ ...ask, skill_id: "k2", name: "tides", reason: "" }] });
    await userEvent.click(within(panel).getByRole("button", { name: "Give forecast" }));
    await waitFor(() => expect(give).toHaveBeenCalledWith("sky", "k1"));
    await userEvent.click(within(panel).getByRole("button", { name: "Decline tides" }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith("sky", "k2"));
  });

  it("reviews a new Instruction the AI app proposed on the Instruction tab, or discards it", async () => {
    const proposal = { text: "Be brief. Answer in French.", reason: "Asked for French." };
    const { onChange } = setup({ instructions: "Be brief.", instruction_proposal: proposal });
    let panel = await proposals();
    expect(within(panel).getByText("Why: Asked for French.")).toBeTruthy();
    // Viewed beside the agent's own; hidden again.
    await userEvent.click(within(panel).getByRole("button", { name: "View" }));
    expect(within(panel).getByText("Be brief.")).toBeTruthy();
    expect(within(panel).getByText("Be brief. Answer in French.")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Hide" }));
    expect(within(panel).queryByText("Be brief.")).toBeNull();
    // Reviewed: the draft on the Instruction tab, for Save.
    await userEvent.click(within(panel).getByRole("button", { name: "Review A new Instruction" }));
    expect(onChange).toHaveBeenLastCalledWith({ instructions: "Be brief. Answer in French." });
    expect(onInstructions).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    // Discarded: the agent's own kept.
    panel = await proposals();
    await userEvent.click(within(panel).getByRole("button", { name: "Discard A new Instruction" }));
    expect(onChange).toHaveBeenLastCalledWith({ instructions: "Be brief." });
  });

  it("shows a proposed Instruction for an agent with none, and reads one it cannot as none", async () => {
    const { unmount } = setup({ instruction_proposal: { text: "Help with taxes." } });
    const panel = await proposals();
    expect(within(panel).queryByText(/^Why:/)).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "View" }));
    expect(within(panel).getByText("(none)")).toBeTruthy();
    unmount();
    setup({ instruction_proposal: { text: 3 } });
    await screen.findByRole("tab", { name: /^Installed tools/ });
    expect(screen.queryByRole("button", { name: /proposals? from your AI app/i })).toBeNull();
  });

  it("keeps a kind's drafts given when its tools are given", async () => {
    have(tool("news", "https://bbc.com/news", { address: "https://bbc.com/news", draft: true }, { id: "d3", description: "World news." }), tool("news", "https://ft.com", { address: "https://ft.com" }, { id: "n1", description: "Money." }));
    setup({ browser_link: "l1", agent_type_id: "t-chrome" });
    await userEvent.click(await screen.findByRole("button", { name: "Remove News" }));
    await waitFor(() => expect(api.setAgentTools).toHaveBeenCalledWith("sky", "news", ["d3"]));
  });

  it("opens a change proposed to a SQL tool, applies it, or discards it", async () => {
    const pending = { name: "count_more", description: "Counts more.", config: { connection_id: "postgres-shop", params: [], sql: "SELECT 2" } };
    have(
      tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me" }),
      tool("sql", "count_orders", { connection_id: "postgres-shop", params: [], sql: "SELECT 1", pending }, { id: "s1", description: "Counts." }),
    );
    setup({});
    const row = await screen.findByRole("heading", { name: "count_orders" }).then((h) => h.closest("div.rounded-xl") as HTMLElement);
    const panel = await proposals();
    expect(within(panel).getByText("Change to a SQL tool")).toBeTruthy();
    // Closed with ×; it opens again, and goes once a SQL change is opened for review.
    await userEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Change proposed — review it" }));
    expect(screen.getByRole("heading", { name: "Review a change to count_orders" })).toBeTruthy();
    expect(screen.getByText("It changes: name, description, SQL.")).toBeTruthy();
    expect(screen.getByText("SELECT 1")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("count_more");
    await userEvent.click(screen.getByRole("button", { name: "Apply change" }));
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "count_more", config: expect.objectContaining({ sql: "SELECT 2" }) })));
  });

  it("discards a change proposed to a SQL tool: saved as it is", async () => {
    const pending = { name: "count_more", description: "Counts more.", config: { connection_id: "postgres-shop", params: [], sql: "SELECT 2" } };
    have(
      tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me" }),
      tool("sql", "count_orders", { connection_id: "postgres-shop", params: [], sql: "SELECT 1", pending }, { id: "s1", description: "Counts." }),
    );
    setup({});
    await userEvent.click(within(await proposals()).getByRole("button", { name: "Review count_orders" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard change" }));
    await waitFor(() => expect(api.updateTool).toHaveBeenCalledWith("s1", expect.objectContaining({ name: "count_orders", config: expect.objectContaining({ sql: "SELECT 1" }) })));
    expect(await screen.findByRole("tab", { name: /^Installed tools/ })).toBeTruthy();
  });

  it("says why a change could not be discarded", async () => {
    const pending = { name: "x", description: "X.", config: { connection_id: "postgres-shop", params: [], sql: "SELECT 2" } };
    have(tool("postgres", "shop", { host: "db", port: 5432, database: "orders", user: "me" }), tool("sql", "q", { connection_id: "postgres-shop", params: [], sql: "SELECT 1", pending }, { id: "s1", description: "Q." }));
    vi.mocked(api.updateTool).mockRejectedValueOnce(new Error("HTTP 409: There is already a sql tool named 'q'."));
    setup({});
    await userEvent.click(within(await proposals()).getByRole("button", { name: "Review q" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard change" }));
    expect(await screen.findByText("HTTP 409: There is already a sql tool named 'q'.")).toBeTruthy();
  });

  it("turns on a switch the AI app asked for, or declines it, with the settings' Save", async () => {
    const asked = { switch_requests: { screen_control: { reason: "To read a chart." }, browser_devtools: { reason: "" }, run_any_program: { reason: "R." } } };
    const { onChange } = setup({ mac_link: "m1", agent_type_id: "t-osx", ...asked });
    const panel = await proposals();
    expect(within(panel).getByText("Why: To read a chart.")).toBeTruthy();
    expect(within(panel).getAllByText(/Turning it on takes effect when you click Save/)).toHaveLength(3);
    await userEvent.click(within(panel).getByRole("button", { name: "Turn on Screen control" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ screen_control: true, switch_requests: { browser_devtools: { reason: "" }, run_any_program: { reason: "R." } } }));
    await userEvent.click(within(panel).getByRole("button", { name: "Turn on Web development tools" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ browser_devtools: true, browser_access: true }));
    await userEvent.click(within(panel).getByRole("button", { name: "Decline Run any program" }));
    expect(onChange.mock.lastCall![0].run_any_program).toBeUndefined();
  });

  it("names a switch it does not know by its field, and reads requests it cannot as none", async () => {
    const { onChange, unmount } = setup({ switch_requests: { browser_access: { reason: "B." }, warp_drive: 1 } });
    const panel = await proposals();
    expect(within(panel).getByRole("button", { name: "Turn on Browser access" })).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Decline warp_drive" }));
    expect(onChange).toHaveBeenCalled();
    unmount();
    setup({ switch_requests: ["x"] });
    await screen.findByRole("tab", { name: /^Installed tools/ });
    expect(screen.queryByRole("button", { name: /proposals? from your AI app/i })).toBeNull();
  });

  it("offers nothing to add before the agent types are read", async () => {
    forgetAgentTypes();
    let answer!: (r: { types: api.AgentType[] }) => void;
    vi.spyOn(api, "fetchAgentTypes").mockReturnValue(new Promise((r) => (answer = r)));
    setup({ mac_link: "m1", agent_type_id: "t-osx" });
    await openLibrary();
    expect(screen.getByText("Reading which agents may have it…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    answer({ types: TYPES });
    expect(await screen.findByRole("button", { name: "Add Run local program" })).toBeTruthy();
  });

  it("draws a switch of a kind of device to come as a toggle in Wysebee Cloud's words", async () => {
    // A pack's type this page has no rows for: its own link and one switch.
    const glasses: api.AgentType = {
      id: "t-glasses", key: "wysebee-glasses", name: "Wysebee Glasses Agent", description: "", enabled: true, kind: "glasses", link_field: "glasses_link",
      tool_kinds: ["camera"], settings: [{ field: "glasses_camera", label: "Camera", tool_kind: "camera", description: "Let Wysebee see what you see." }],
    };
    forgetAgentTypes();
    vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: [...TYPES, glasses] });
    await loadAgentTypes();
    const config = { glasses_link: "g1", agent_type_id: "t-glasses" };
    const { onChange, unmount } = setup(config);
    await openLibrary();
    // Only its switch: no computer's tools, no browser's (the database tab is any agent's).
    expect(tabs()).toContain("Local File & Folder");
    expect(screen.queryByRole("button", { name: "Add Run local program" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Camera" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add Camera" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...config, glasses_camera: true });
    unmount();
    // On: installed, with its words, and taken away with the trash.
    const on = setup({ ...config, glasses_camera: true, switch_requests: { glasses_camera: { reason: "To see." } } });
    expect(await within(row("Camera")).findByText("Let Wysebee see what you see.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Camera" }));
    expect(on.onChange).toHaveBeenLastCalledWith({ ...config, glasses_camera: false, switch_requests: { glasses_camera: { reason: "To see." } } });
    // Asked for by the AI app: named in its words too.
    expect(within(await proposals()).getByRole("button", { name: "Turn on Camera" })).toBeTruthy();
    on.unmount();
    // A switch with no description is said by its name.
    forgetAgentTypes();
    vi.spyOn(api, "fetchAgentTypes").mockResolvedValue({ types: [{ ...glasses, settings: [{ ...glasses.settings[0], description: "" }] }] });
    await loadAgentTypes();
    const named = async () => within(await screen.findByRole("heading", { name: "Camera" }).then((h) => h.closest("div.rounded-xl") as HTMLElement)).findAllByText("Camera");
    const both = setup({ ...config, glasses_camera: true });
    // Its title, and its line: installed, and in the library while off.
    expect(await named()).toHaveLength(2);
    both.unmount();
    setup(config);
    await openLibrary();
    expect(await named()).toHaveLength(2);
  });

  it("says when a SQL tool's database is not connected to the agent", async () => {
    have(tool("sql", "count_orders", { connection_id: "gone", params: [], sql: "SELECT 1" }, { description: "Counts." }));
    setup({});
    expect(await screen.findByText("Its database is not connected to this agent")).toBeTruthy();
  });

});
