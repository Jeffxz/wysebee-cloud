import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { resetAgents } from "../agents";
import type { BrowserLink } from "../api";
import { resetPresence } from "../presence";
import { AgentsList } from "./AgentsList";

useFetchTransport();

beforeEach(() => {
  resetAgents();
  resetPresence();
});

const AGENTS = {
  rows: [
    { id: "w", agent_name: "wysebee", label: "Wysebee", updated_at: null },
    { id: "a1", agent_name: "kim-pc", label: "Kim PC", device: "wysebee-windows", updated_at: null },
    { id: "a2", agent_name: "phone", label: "Phone", device: "wysebee-android", updated_at: null },
    { id: "a3", agent_name: "scout", label: "Scout", browser: true, updated_at: null },
    { id: "a4", agent_name: "aide", label: "Aide", updated_at: null },
  ],
};

function link(over: Partial<BrowserLink> & { id: string; agent: string }): BrowserLink {
  return { label: over.agent, browser: "Chrome", extension_version: "1.0.0", status: "connected", paused: false, last_seen: null, created_at: "2026-11-01T00:00:00Z", ...over };
}

const LINKS = {
  links: [
    link({ id: "l1", agent: "kim-pc", kind: "osx", browser: "KIM", status: "offline", agent_type: { id: "t", key: "wysebee-windows", name: "Wysebee Windows Agent" } }),
    link({ id: "l2", agent: "phone", kind: "android", browser: "Pixel" }),
    link({ id: "l3", agent: "scout", kind: "browser", paused: true }),
  ],
};

const rowOf = (name: RegExp) => screen.getByRole("button", { name }).closest("li") as HTMLElement;

describe("AgentsList", () => {
  it("lists every agent with where it works and whether it is reached, and opens one", async () => {
    mockFetch({ "GET /agent/agents": AGENTS, "GET /api/v1/browser-links": LINKS });
    const onOpen = vi.fn();
    render(<AgentsList onOpen={onOpen} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    await screen.findByText("@kim-pc");
    await waitFor(() => expect(within(rowOf(/Kim PC/)).getByText("Offline")).toBeTruthy());
    expect(within(rowOf(/Kim PC/)).getByText("Wysebee Windows Agent · KIM")).toBeTruthy();
    // A device with no type named: its kind's name.
    expect(within(rowOf(/Phone/)).getByText("Android phone · Pixel")).toBeTruthy();
    expect(within(rowOf(/Phone/)).getByText("Online")).toBeTruthy();
    expect(within(rowOf(/Scout/)).getByText("Paused")).toBeTruthy();
    // In Wysebee Cloud: always online.
    expect(within(rowOf(/Aide/)).getByText("Runs in Wysebee Cloud")).toBeTruthy();
    expect(within(rowOf(/Aide/)).getByText("Online")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.querySelector(".truncate")?.textContent)).toEqual(["Wysebee", "Aide", "Kim PC", "Phone", "Scout"]);
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /Scout/ }));
    expect(onOpen).toHaveBeenLastCalledWith("a3");
  });

  it("shows no status for a paired agent until the links are read", async () => {
    mockFetch({ "GET /agent/agents": AGENTS, "GET /api/v1/browser-links": () => new Promise(() => {}) });
    render(<AgentsList onOpen={vi.fn()} />);
    await screen.findByText("@kim-pc");
    expect(within(rowOf(/Kim PC/)).queryByText(/Online|Offline|Paused/)).toBeNull();
    expect(within(rowOf(/Kim PC/)).getByText("Windows PC")).toBeTruthy();
  });

  it("says why the agents could not be read", async () => {
    mockFetch({ "GET /agent/agents": reply(500, { detail: "cloud down" }), "GET /api/v1/browser-links": { links: [] } });
    render(<AgentsList onOpen={vi.fn()} />);
    expect(await screen.findByText("HTTP 500: cloud down")).toBeTruthy();
  });

  it("adds an agent and opens it", async () => {
    const f = mockFetch({
      "GET /agent/agents": AGENTS,
      "GET /api/v1/browser-links": LINKS,
      "POST /agent/agents": (r: FakeRequest) => ({ id: "new-id", agent_name: (r.body as { name: string }).name, config: { label: (r.body as { label: string }).label }, system_prompt: "", creator: "", updated_at: null }),
    });
    const onOpen = vi.fn();
    render(<AgentsList onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "Add an agent" }));
    const dialog = screen.getByRole("dialog", { name: "Add an agent" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Travel Planner");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add agent" }));
    await waitFor(() => expect(onOpen).toHaveBeenLastCalledWith("new-id"));
    expect(f.to("POST /agent/agents")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Escape closes it.
    await userEvent.click(screen.getByRole("button", { name: "Add an agent" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
