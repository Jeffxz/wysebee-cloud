import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { resetAgents } from "../agents";
import type { BrowserLink } from "../api";
import { resetPresence } from "../presence";
import { dialogs } from "./common/confirm";
import { DeviceDetail } from "./DeviceDetail";

useFetchTransport();

beforeEach(() => {
  resetPresence();
  resetAgents();
});

const LIST = "GET /api/v1/browser-links";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function link(over: Partial<BrowserLink> & { id: string }): BrowserLink {
  return { agent: over.id, label: over.id, browser: "Chrome", extension_version: "1.0.0", status: "connected", paused: false, last_seen: minutesAgo(1), created_at: "2026-11-01T10:00:00Z", ...over };
}

function setup(device: string, links: BrowserLink[], routes: Record<string, unknown> = {}) {
  const f = mockFetch({ [LIST]: () => ({ links }), "GET /agent/agents": { rows: [] }, ...routes });
  const onOpenAgent = vi.fn();
  const onUnpaired = vi.fn();
  render(<DeviceDetail device={device} onOpenAgent={onOpenAgent} onUnpaired={onUnpaired} />);
  return { f, onOpenAgent, onUnpaired };
}

const fact = (label: string) => screen.queryByText(label)?.nextElementSibling?.textContent;

describe("DeviceDetail", () => {
  it("shows Wysebee Cloud, always connected", () => {
    setup("cloud", []);
    expect(screen.getByRole("heading", { name: "Wysebee Cloud" })).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Keeps your agents, tasks and workspaces.")).toBeTruthy();
  });

  it("says it is reading, then that a device no longer paired is gone, with a way back", async () => {
    const { onUnpaired } = setup("gone", []);
    expect(screen.getByText("Reading your devices…")).toBeTruthy();
    expect(await screen.findByText("This device is not paired any more.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "All devices" }));
    expect(onUnpaired).toHaveBeenCalled();
  });

  it("shows a browser: its agent, what it is and whether it is reached, without a computer's permissions", async () => {
    const { onOpenAgent } = setup("b1", [
      link({ id: "b1", agent: "scout", label: "Kim Chrome", kind: "browser", agent_type: { id: "t", key: "wysebee-browser-chrome", name: "Wysebee Chrome Agent" } }),
    ]);
    expect(await screen.findByRole("heading", { name: /Kim Chrome/ })).toBeTruthy();
    expect(screen.getAllByText("@scout")).toHaveLength(2);
    expect(screen.getAllByText("Connected").length).toBe(2);
    expect(fact("Type")).toBe("Wysebee Chrome Agent");
    expect(fact("Browser")).toBe("Chrome");
    expect(fact("Version")).toBe("1.0.0");
    expect(fact("Last seen")).toBeTruthy();
    expect(fact("Paired")).toContain("2026");
    expect(screen.queryByText("Programs allowed")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Open agent" }));
    expect(onOpenAgent).toHaveBeenLastCalledWith("scout");
    onOpenAgent.mockClear();
    await userEvent.click(within(screen.getByText("Agent").parentElement as HTMLElement).getByRole("button"));
    expect(onOpenAgent).toHaveBeenLastCalledWith("scout");
  });

  it("shows a paused computer, what was allowed on it, and leaves out what it does not say", async () => {
    setup("p1", [
      link({
        id: "p1",
        label: "Kim PC",
        kind: "osx",
        browser: "KIM",
        extension_version: "",
        status: "offline",
        paused: true,
        last_seen: minutesAgo(5),
        approved: ["say", "open"],
        approved_skills: [],
        folders: [
          { id: "f1", name: "Docs", path: "/Users/kim/Docs", mode: "write", description: "Work notes" },
          { id: "f2", name: "Pics", path: "/Users/kim/Pics", mode: "read", description: "" },
        ],
      }),
    ]);
    expect(await screen.findByText("Paused")).toBeTruthy();
    expect(screen.getByText("Offline — last seen 5 minutes ago")).toBeTruthy();
    expect(fact("Status")).toBe("Paused in Wysebee Agent");
    expect(fact("Device")).toBe("KIM");
    expect(fact("Type")).toBeUndefined();
    expect(fact("Version")).toBeUndefined();
    expect(screen.getByText("say")).toBeTruthy();
    expect(screen.getByText("open")).toBeTruthy();
    expect(screen.getAllByText("None allowed yet.")).toHaveLength(1);
    expect(screen.getByText("Read and write")).toBeTruthy();
    expect(screen.getByText("Read only")).toBeTruthy();
    expect(screen.getByText("Work notes")).toBeTruthy();
    expect(screen.getByText("/Users/kim/Pics")).toBeTruthy();
  });

  it("shows a phone never seen, with nothing allowed yet", async () => {
    setup("a1", [link({ id: "a1", label: "Phone", kind: "android", status: "offline", last_seen: null })]);
    expect(await screen.findByRole("heading", { name: /Phone/ })).toBeTruthy();
    expect(fact("Last seen")).toBeUndefined();
    expect(fact("Status")).toBe("Offline");
    expect(screen.getAllByText("None allowed yet.")).toHaveLength(3);
  });

  it("unpairs after asking, then goes back to the list", async () => {
    const links = [link({ id: "b1", agent: "scout", label: "Kim Chrome", kind: "browser" })];
    const { f, onUnpaired } = setup("b1", links, {
      "POST /api/v1/browser-links/b1/unpair": () => {
        links.length = 0;
        return reply(204);
      },
    });
    vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    await userEvent.click(await screen.findByRole("button", { name: "Unpair" }));
    expect(f.to("POST /api/v1/browser-links/b1/unpair")).toHaveLength(0);
    expect(onUnpaired).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Unpair" }));
    await waitFor(() => expect(onUnpaired).toHaveBeenCalled());
    expect(f.to("POST /api/v1/browser-links/b1/unpair")).toHaveLength(1);
  });
});
