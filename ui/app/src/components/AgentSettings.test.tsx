import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { TYPES } from "../../../test/agentTypes";
import { forgetAgentTypes } from "../agentTypes";
import { AgentSettings } from "./AgentSettings";
import { dialogs } from "./common/confirm";

useFetchTransport();

const PATH = "/agent/agents/w";
const detail = (config: Record<string, unknown>) => ({ id: "w", agent_name: "wysebee", config, system_prompt: "", creator: "", creator_name: "", updated_at: null, location: "cloud" });

function setup(over: Record<string, unknown> = {}, props: Partial<Parameters<typeof AgentSettings>[0]> = {}) {
  // The agent types are read once a session: again for each test.
  forgetAgentTypes();
  const f = mockFetch({
    [`GET ${PATH}`]: detail({ label: "Bee", avatar: "🐝", instructions: "Be brief.", browser_access: true, browser_link: "l1", agent_type_id: "t-chrome" }),
    "GET /api/v1/browser-links": { links: [] },
    "GET /api/v1/agent-types": { types: TYPES },
    [`PUT ${PATH}`]: (r: { body: unknown }) => detail((r.body as { config: Record<string, unknown> }).config),
    ...over,
  });
  const onDeleted = vi.fn();
  const onTabChange = vi.fn();
  const utils = render(<AgentSettings agentId="w" tab="tools" onTabChange={onTabChange} onDeleted={onDeleted} meRole="AGENT_ADMIN" currentUserEmail="" {...props} />);
  return { f, onDeleted, onTabChange, ...utils };
}

describe("an agent's settings, Home's page", () => {
  it("gives the agent a skill on Skills at once, by its id, not with Save", async () => {
    const skill = (name: string) => ({ id: `id-${name}`, name, description: `${name}.`, files: [], updated_at: null });
    const { f } = setup(
      {
        [`GET ${PATH}`]: { ...detail({ label: "Bee" }), id: "a9" },
        "GET /api/v1/skills": { skills: [skill("notes"), skill("weather")] },
        "GET /api/v1/agents/a9/skills": { skills: [skill("weather")] },
        "PUT /api/v1/agents/a9/skills": (r: { body: { skill_ids: string[] } }) => ({ skills: r.body.skill_ids.map((i) => skill(i.slice(3))) }),
      },
      { tab: "skills" },
    );
    const weather = (await screen.findByRole("checkbox", { name: "Give this agent weather" })) as HTMLInputElement;
    await waitFor(() => expect(weather.checked).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: "Give this agent notes" }));
    await waitFor(() => expect(f.to("PUT /api/v1/agents/a9/skills")).toHaveLength(1));
    expect(f.to("PUT /api/v1/agents/a9/skills")[0].body).toEqual({ skill_ids: ["id-weather", "id-notes"] });
    // Nothing waits for Save.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(f.to(`PUT ${PATH}`)).toHaveLength(0);
  });

  it("says when there are no skills; Wysebee's are read by its id", async () => {
    const { f } = setup({ "GET /api/v1/skills": { skills: [] }, "GET /api/v1/agents/w/skills": { skills: [] } }, { tab: "skills" });
    expect(await screen.findByText(/No skills yet/)).toBeTruthy();
    expect(f.to("GET /api/v1/agents/w/skills")).toHaveLength(1);
  });

  it("shows why the skills could not be read", async () => {
    setup({ "GET /api/v1/skills": reply(503, { detail: "cloud down" }) }, { tab: "skills" });
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
  });

  it("shows Wysebee's tools, holds edits for Save, and saves them to the cloud", async () => {
    const { f, onTabChange } = setup();
    expect(await screen.findByRole("heading", { name: "Bee" })).toBeTruthy();
    // The Tools tab is laid out as Wysebee Desktop's: Installed tools, then the Tool library.
    await userEvent.click(screen.getByRole("tab", { name: "Tool library" }));
    await userEvent.click(screen.getByRole("button", { name: "Add Web development tools" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.to(`PUT ${PATH}`)).toHaveLength(1));
    expect((f.to(`PUT ${PATH}`)[0].body as { config: Record<string, unknown> }).config).toMatchObject({ browser_access: true, browser_devtools: true });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).toBeNull());
    await userEvent.click(screen.getByRole("tab", { name: "Instruction" }));
    expect(onTabChange).toHaveBeenCalledWith("instructions");
  });

  it("sends a SQL Query tool with no database to connect one on General", async () => {
    const { onTabChange } = setup({ "GET /api/v1/agents/w/tools": { tools: [] }, "GET /api/v1/tools": { tools: [] } });
    expect(await screen.findByRole("heading", { name: "Bee" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Tool library" }));
    await userEvent.click(screen.getByRole("tab", { name: "Database" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Add SQL Query" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Add SQL Query" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect a database" }));
    expect(onTabChange).toHaveBeenCalledWith("property");
  });

  it("opens the Instruction tab to review a new Instruction the AI app proposed", async () => {
    const { onTabChange } = setup({
      [`GET ${PATH}`]: detail({ label: "Bee", instructions: "Be brief.", instruction_proposal: { text: "Be kind.", reason: "R." } }),
      "GET /api/v1/agents/w/tools": { tools: [] },
      "GET /api/v1/tools": { tools: [] },
    });
    await userEvent.click(await screen.findByRole("button", { name: /proposal from your AI app/ }));
    await userEvent.click(screen.getByRole("button", { name: "Review A new Instruction" }));
    expect(onTabChange).toHaveBeenCalledWith("instructions");
    // Held for Save, as any edit.
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("edits the instructions on their tab, and discards back to what is saved", async () => {
    const { f } = setup({}, { tab: "instructions" });
    const box = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(box.value).toBe("Be brief.");
    fireEvent.change(box, { target: { value: "Be kind." } });
    await userEvent.click(await screen.findByRole("button", { name: "Discard" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Be brief.");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Be kind." } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect((f.to(`PUT ${PATH}`)[0].body as { config: Record<string, unknown> }).config.instructions).toBe("Be kind."));
  });

  it("is a page of Home, open on General when no tab is named", async () => {
    setup({}, { tab: null });
    expect(await screen.findByRole("region", { name: "Wysebee's settings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("says why Wysebee could not be read or saved, and names it by its agent name with no label", async () => {
    setup({ [`GET ${PATH}`]: reply(503, { detail: "Cloud down" }) });
    expect(await screen.findByText(/Cloud down/)).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("shows a refused save, and someone who may not edit gets no switches", async () => {
    setup({ [`GET ${PATH}`]: detail({ instructions: 3, browser_link: "l1", agent_type_id: "t-chrome" }), [`PUT ${PATH}`]: reply(409, { detail: "Changed on another device." }) });
    expect(await screen.findByRole("heading", { name: "wysebee" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove Browser access" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Changed on another device/)).toBeTruthy();
  });

  it("starts with no instructions when there are none", async () => {
    setup({ [`GET ${PATH}`]: detail({}) }, { tab: "instructions" });
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("");
  });

  it("is read only for a reader, and loads before showing anything", async () => {
    let release = () => {};
    setup({ [`GET ${PATH}`]: () => new Promise((resolve) => (release = () => resolve(detail({ browser_link: "l1", agent_type_id: "t-chrome" }))))}, { meRole: "AGENT_READER" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    release();
    // Its browser is shown, with nothing to change and no library.
    expect(await screen.findByRole("heading", { name: "Browser access" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Tool library" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Browser access" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add News" })).toBeNull();
  });

  it("for one of the person's own agents: General with its name and Delete, then Tools, Skills and Instruction", async () => {
    const aide = (config: Record<string, unknown>) => ({ ...detail(config), agent_name: "aide", id: "a1" });
    let refuse = false;
    const f = mockFetch({
      "GET /agent/agents/a1": aide({ label: "Aide" }),
      "PUT /agent/agents/a1": (r: { body: unknown }) => aide((r.body as { config: Record<string, unknown> }).config),
      "GET /agent/agents": { rows: [] },
      "DELETE /agent/agents/a1": () => (refuse ? reply(502, { detail: "cloud down" }) : reply(204, null)),
    });
    const onDeleted = vi.fn();
    const onTabChange = vi.fn();
    const { unmount } = render(
      <AgentSettings agentId="a1" agentName="aide" tab="instructions" onTabChange={onTabChange} onDeleted={onDeleted} meRole="AGENT_ADMIN" currentUserEmail="" />,
    );
    expect(await screen.findByRole("heading", { name: "Aide" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Aide's settings" })).toBeTruthy();
    // Every agent has its Connect AI app: Wysebee Assistant's address and its switch.
    expect(within(screen.getAllByRole("tablist")[0]).getAllByRole("tab").map((x) => x.textContent)).toEqual(["General", "Tools", "Skills", "Instruction", "Connect AI app"]);
    unmount();
    // General: its name, saved with the bar, read again for Home's menu.
    render(<AgentSettings agentId="a1" agentName="aide" tab="property" onTabChange={onTabChange} onDeleted={onDeleted} meRole="AGENT_ADMIN" currentUserEmail="" />);
    const name = (await screen.findByRole("textbox", { name: "Label" })) as HTMLInputElement;
    expect(name.value).toBe("Aide");
    fireEvent.change(name, { target: { value: "My Aide" } });
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.to("GET /agent/agents").length).toBeGreaterThan(0));
    expect((f.to("PUT /agent/agents/a1")[0].body as { config: Record<string, unknown> }).config.label).toBe("My Aide");
    // Delete asks first; a refusal shows.
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete agent" }));
    expect(f.to("DELETE /agent/agents/a1")).toHaveLength(0);
    refuse = true;
    await userEvent.click(screen.getByRole("button", { name: "Delete agent" }));
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Delete agent" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    confirm.mockRestore();
  });

  it("renames one of the person's own agents: a new handle, checked first, saved with the bar", async () => {
    const aide = (config: Record<string, unknown>, name: string) => ({ ...detail(config), id: "a1", agent_name: name });
    const f = mockFetch({
      "GET /agent/agents/a1": aide({ label: "Aide" }, "aide"),
      "PUT /agent/agents/a1": (r: { body: { config: Record<string, unknown>; name?: string } }) =>
        r.body.name === "taken" ? reply(409, { detail: "There is already an agent named 'taken'." }) : aide(r.body.config, r.body.name ?? "aide"),
      "GET /agent/agents": { rows: [] },
    });
    render(<AgentSettings agentId="a1" agentName="aide" tab="property" onTabChange={vi.fn()} onDeleted={vi.fn()} meRole="AGENT_ADMIN" currentUserEmail="" />);
    const handle = (await screen.findByRole("textbox", { name: "@ handle" })) as HTMLInputElement;
    expect(handle.value).toBe("aide");
    // Not a handle: said, and nothing sent.
    fireEvent.change(handle, { target: { value: " Bad Name! " } });
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/A handle starts with a lowercase letter/)).toBeTruthy();
    expect(f.to("PUT /agent/agents/a1")).toHaveLength(0);
    // Discarded: back to the saved one, and the message goes.
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect((screen.getByRole("textbox", { name: "@ handle" }) as HTMLInputElement).value).toBe("aide");
    expect(screen.queryByText(/A handle starts with a lowercase letter/)).toBeNull();
    // Taken: Wysebee Cloud's refusal shows.
    fireEvent.change(screen.getByRole("textbox", { name: "@ handle" }), { target: { value: "taken" } });
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/already an agent named 'taken'/)).toBeTruthy();
    // A good one: sent with the settings; the page shows it.
    fireEvent.change(screen.getByRole("textbox", { name: "@ handle" }), { target: { value: "Helper" } });
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.to("PUT /agent/agents/a1").map((r) => r.body)).toContainEqual({ config: { label: "Aide" }, name: "helper" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "@ handle" }) as HTMLInputElement).value).toBe("helper"));
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("tells Home after a delete, and lets only an editor change it", async () => {
    mockFetch({
      "GET /agent/agents/a1": { ...detail({}), agent_name: "aide", id: "a1", creator: "someone@else" },
      "DELETE /agent/agents/a1": reply(204, null),
    });
    const onDeleted = vi.fn();
    const { unmount } = render(<AgentSettings agentId="a1" agentName="aide" tab="property" onTabChange={vi.fn()} onDeleted={onDeleted} meRole="AGENT_ADMIN" currentUserEmail="" />);
    // No label: its name, and an empty field.
    expect(await screen.findByRole("heading", { name: "aide" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Label" }) as HTMLInputElement).value).toBe("");
    vi.spyOn(dialogs, "confirm").mockResolvedValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Delete agent" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    unmount();
    render(<AgentSettings agentId="a1" agentName="aide" tab="property" onTabChange={vi.fn()} onDeleted={onDeleted} meRole="AGENT_EDITOR" currentUserEmail="me@x" />);
    expect(await screen.findByRole("textbox", { name: "Label" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Delete agent" })).toBeNull();
  });

  it("has no Home picker on General: where an agent lives cannot be changed", async () => {
    mockFetch({ [`GET ${PATH}`]: detail({ label: "Bee", home: "pc" }) });
    render(<AgentSettings agentId="w" tab={"property"} onTabChange={vi.fn()} onDeleted={vi.fn()} meRole="AGENT_ADMIN" currentUserEmail="" />);
    expect(await screen.findByText("Avatar")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Home" })).toBeNull();
    // Wysebee's General is its picture alone: no name to change, no Delete.
    expect(screen.queryByRole("textbox", { name: "Label" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "@ handle" })).toBeNull();
    // No model to choose, and no API: Wysebee Cloud runs no model.
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
  });

  it("changes the avatar on General, saved at once beside edits waiting for the bar", async () => {
    // One of the person's own agents: its name is the edit that waits for the bar.
    const PATH = "/agent/agents/a1";
    const f = mockFetch({
      [`GET ${PATH}`]: { ...detail({ label: "Bee", avatar: "🐝" }), agent_name: "aide", id: "a1" },
      [`PUT ${PATH}`]: (r: { body: unknown }) => ({ ...detail((r.body as { config: Record<string, unknown> }).config), agent_name: "aide", id: "a1" }),
      "GET /agent/agents": { rows: [] },
    });
    render(<AgentSettings agentId="a1" agentName="aide" tab="property" onTabChange={vi.fn()} onDeleted={vi.fn()} meRole="AGENT_ADMIN" currentUserEmail="" />);
    expect(await screen.findByText("Avatar")).toBeTruthy();
    // An edit waiting for the bar: its name.
    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), { target: { value: "Bee 2" } });
    await userEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    const picker = screen.getByRole("dialog", { name: "Agent avatar" });
    // Escape and its backdrop close the picker, not the settings.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Agent avatar" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    fireEvent.click(screen.getByRole("dialog", { name: "Agent avatar" }));
    expect(screen.queryByRole("dialog", { name: "Agent avatar" })).toBeNull();
    expect(picker).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Agent avatar" })).getByRole("button", { name: "Use 🤖" }));
    await waitFor(() => expect(f.to(`PUT ${PATH}`)).toHaveLength(1));
    // Saved on top of the settings as saved: the name edit still waits for the bar.
    expect((f.to(`PUT ${PATH}`)[0].body as { config: Record<string, unknown> }).config).toEqual({ label: "Bee", avatar: "🤖" });
    expect(await screen.findByText("Unsaved changes")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(f.to(`PUT ${PATH}`)).toHaveLength(2));
    expect((f.to(`PUT ${PATH}`)[1].body as { config: Record<string, unknown> }).config).toMatchObject({ avatar: "🤖", label: "Bee 2" });
    // Back to the default: the field goes.
    await userEvent.click(screen.getByRole("button", { name: "Change avatar" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Agent avatar" })).getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(f.to(`PUT ${PATH}`)).toHaveLength(3));
    expect("avatar" in (f.to(`PUT ${PATH}`)[2].body as { config: Record<string, unknown> }).config).toBe(false);
  });

  it("connects an AI app to Wysebee through Wysebee Cloud, on its own tab", async () => {
    mockFetch({
      [`GET ${PATH}`]: detail({ label: "Bee" }),
      "GET /api/v1/desktops": { desktops: [] },
      "GET /api/v1/cloud-mcp-status?agent=wysebee": { url: "https://wysebee.example/assistant/mcp", exposed: true, tools: [], skills: 1, offline: null },
    });
    render(<AgentSettings agentId="w" tab={"mcp"} onTabChange={vi.fn()} onDeleted={vi.fn()} meRole="AGENT_ADMIN" currentUserEmail="" />);
    expect((await screen.findByRole("tab", { name: "Connect AI app" })).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("https://wysebee.example/assistant/mcp")).toBeTruthy();
  });
});
