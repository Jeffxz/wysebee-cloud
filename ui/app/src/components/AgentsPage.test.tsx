import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply } from "../../../test/fetch";
import { AgentsPage, SETTINGS_TABS, settingsTabFromSegment } from "./AgentsPage";
import { resetAgents } from "../agents";
import { useFetchTransport } from "../../../test/transport";

useFetchTransport();

// The settings have tests of their own; here they only show what they were given and call back.
vi.mock("./AgentSettings", () => ({
  AgentSettings: (p: { agentName: string; tab: string | null; onTabChange: (t: string) => void; onDeleted: () => void }) => (
    <div data-testid="settings">
      <span>{`settings:${p.agentName}:${p.tab ?? ""}`}</span>
      <button type="button" onClick={() => p.onTabChange("instructions")}>
        to instructions
      </button>
      <button type="button" onClick={p.onDeleted}>
        deleted there
      </button>
    </div>
  ),
}));

const AGENTS = "GET /agent/agents";
const rows = { rows: [{ id: "w", agent_name: "wysebee", label: "Bee", updated_at: null }, { id: "a1", agent_name: "aide", label: "Aide", updated_at: null }] };

beforeEach(() => resetAgents());

describe("AgentsPage", () => {
  it("names its tabs, and reads a tab from the address", () => {
    expect(SETTINGS_TABS.map(([k]) => k)).toEqual(["property", "tools", "skills", "instructions", "mcp"]);
    expect(settingsTabFromSegment("capabilities")).toBe("tools");
    expect(settingsTabFromSegment("mcp")).toBe("mcp");
    expect(settingsTabFromSegment("chat")).toBeNull();
    expect(settingsTabFromSegment(undefined)).toBeNull();
  });

  it("is Wysebee's settings unless another agent is named, and opens a tab of the one shown", async () => {
    mockFetch({ [AGENTS]: rows });
    const onOpen = vi.fn();
    const { rerender } = render(<AgentsPage meRole="AGENT_ADMIN" currentUserEmail="" onOpen={onOpen} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(await screen.findByText("settings:wysebee:")).toBeTruthy();
    rerender(<AgentsPage meRole="AGENT_ADMIN" currentUserEmail="" agent="a1" tab="tools" onOpen={onOpen} />);
    expect(await screen.findByText("settings:aide:tools")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "to instructions" }));
    expect(onOpen).toHaveBeenLastCalledWith("a1", "instructions");
    // An older address, by its handle: the same agent.
    rerender(<AgentsPage meRole="AGENT_ADMIN" currentUserEmail="" agent="aide" onOpen={onOpen} />);
    expect(await screen.findByText("settings:aide:")).toBeTruthy();
    // Deleted there: back to Wysebee.
    await userEvent.click(screen.getByRole("button", { name: "deleted there" }));
    expect(onOpen).toHaveBeenLastCalledWith("wysebee");
  });

  it("says an agent is gone, with a way back to Wysebee", async () => {
    mockFetch({ [AGENTS]: rows });
    const onOpen = vi.fn();
    render(<AgentsPage meRole="AGENT_ADMIN" currentUserEmail="" agent="nobody" onOpen={onOpen} />);
    expect(await screen.findByText("This agent no longer exists.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back to Wysebee" }));
    expect(onOpen).toHaveBeenCalledWith("wysebee");
  });

  it("says why the agents could not be read", async () => {
    mockFetch({ [AGENTS]: reply(500, { detail: "cloud down" }) });
    render(<AgentsPage meRole="AGENT_ADMIN" currentUserEmail="" onOpen={vi.fn()} />);
    expect(await screen.findByText("HTTP 500: cloud down")).toBeTruthy();
  });
});
