import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { APP_CHANGED } from "../../api";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { SkillsTab } from "./SkillsTab";

useFetchTransport();

const LIST = "GET /api/v1/skills";
const MINE = "GET /api/v1/agents/a1/skills";
const GIVE = "PUT /api/v1/agents/a1/skills";
const row = (name: string, files: { path: string; size: number }[] = []) => ({ id: `id-${name}`, name, description: `${name}.`, files, updated_at: null });

function setup(routes: Record<string, unknown>, attached: string[] = [], canEdit = true) {
  const f = mockFetch({
    [LIST]: { skills: [row("notes"), row("weather")] },
    [MINE]: { skills: attached.map((n) => row(n)) },
    [GIVE]: (r: { body: { skill_ids: string[] } }) => ({ skills: r.body.skill_ids.map((id) => row(id.slice(3))) }),
    ...routes,
  });
  const utils = render(<SkillsTab agentId="a1" canEdit={canEdit} />);
  return { f, ...utils };
}

const given = (f: ReturnType<typeof mockFetch>) => f.to(GIVE).map((c) => (c.body as { skill_ids: string[] }).skill_ids);

describe("SkillsTab: which skills the agent has (made and changed on the Skills page, 2026-11-17)", () => {
  it("opens the Skills page to make a skill, or to change one", async () => {
    window.location.hash = "#/home/agent/a1/skills";
    setup({});
    await userEvent.click(await screen.findByRole("button", { name: "New skill" }));
    expect(window.location.hash).toBe("#/skills");
    await userEvent.click(screen.getByRole("button", { name: "Change weather" }));
    expect(window.location.hash).toBe("#/skills/id-weather");
  });

  it("reads the lists again when the app's data changes", async () => {
    const { f } = setup({});
    await screen.findByText("notes");
    act(() => {
      window.dispatchEvent(new CustomEvent(APP_CHANGED));
    });
    await waitFor(() => expect(f.to(LIST)).toHaveLength(2));
  });

  it("gives and takes a skill at once with its tick, and says a refusal", async () => {
    let refuse = false;
    const { f } = setup({ [GIVE]: (r: { body: { skill_ids: string[] } }) => (refuse ? reply(404, { detail: "There is no such skill." }) : { skills: r.body.skill_ids.map((id) => row(id.slice(3))) }) }, ["weather"]);
    const weather = (await screen.findByRole("checkbox", { name: "Give this agent weather" })) as HTMLInputElement;
    await waitFor(() => expect(weather.checked).toBe(true));
    await userEvent.click(screen.getByRole("checkbox", { name: "Give this agent notes" }));
    await waitFor(() => expect((screen.getByRole("checkbox", { name: "Give this agent notes" }) as HTMLInputElement).checked).toBe(true));
    await userEvent.click(weather);
    await waitFor(() => expect(weather.checked).toBe(false));
    expect(given(f)).toEqual([["id-weather", "id-notes"], ["id-notes"]]);
    refuse = true;
    await userEvent.click(weather);
    expect(await screen.findByText(/There is no such skill/)).toBeTruthy();
    expect(weather.checked).toBe(false);
  });

  it("says when the agent's skills cannot be read", async () => {
    setup({ [MINE]: reply(503, { detail: "cloud down" }) });
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
  });

  it("says when the agent's skills cannot be read", async () => {
    setup({ [MINE]: reply(503, { detail: "cloud down" }) });
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
  });

  it("drops a list that arrives after the tab is gone", async () => {
    let answer = (_: unknown) => {};
    const { f, unmount } = setup({ [LIST]: () => new Promise((resolve) => (answer = resolve)) });
    await waitFor(() => expect(f.to(LIST)).toHaveLength(1));
    unmount();
    answer({ skills: [row("late")] });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("late")).toBeNull();
  });

  it("offers no changes without edit rights", async () => {
    setup({}, [], false);
    expect(await screen.findByText("notes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New skill" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change notes" })).toBeNull();
  });
});
