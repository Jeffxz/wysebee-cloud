import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { ACTIVITY_CHANGED } from "../api";
import { resetAgents } from "../agents";

vi.mock("./BrowserNotifySwitch", () => ({ BrowserNotifySwitch: () => <div data-testid="browser-switch" /> }));
import { ActivityView } from "./ActivityView";

useFetchTransport();

const LIST = "GET /api/v1/notifications?limit=100";
const READ = "POST /api/v1/notifications/read";
const note = (id: string, title: string, read: boolean, body = "", agent: string | null = null) => ({ id, title, body, agent, created_at: "2026-11-14T10:00:00Z", read });
const AGENTS = { "GET /agent/agents": { rows: [{ agent_name: "wysebee", label: "Wysebee", updated_at: null }, { agent_name: "scout", label: "Scout", avatar: "🧭", updated_at: null }] } };

function listen() {
  const seen: number[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent<{ unread: number }>).detail.unread);
  window.addEventListener(ACTIVITY_CHANGED, on);
  return { seen, stop: () => window.removeEventListener(ACTIVITY_CHANGED, on) };
}

beforeEach(() => resetAgents());

describe("ActivityView", () => {
  it("shows the agent each one is from, by its picture and name, else its handle", async () => {
    mockFetch({
      ...AGENTS,
      [LIST]: { notifications: [note("n3", "From scout", true, "", "scout"), note("n2", "From a gone agent", true, "", "gone"), note("n1", "From nobody", true)], unread: 0 },
    });
    render(<ActivityView />);
    const list = await screen.findByRole("list", { name: "Notifications" });
    const rows = within(list).getAllByRole("listitem");
    await waitFor(() => expect(within(rows[0]).getByText("Scout")).toBeTruthy());
    expect(within(rows[1]).getByText("@gone")).toBeTruthy();
    expect(within(rows[2]).queryByText(/^@|Scout/)).toBeNull();
    expect(screen.getByTestId("browser-switch")).toBeTruthy();
  });

  it("shows only one agent's when asked, and tells the menu what it read", async () => {
    mockFetch({
      ...AGENTS,
      [LIST]: { notifications: [note("n3", "From scout", true, "", "scout"), note("n1", "From nobody", true)], unread: 0 },
    });
    const onItems = vi.fn();
    const { rerender } = render(<ActivityView agent="scout" onItems={onItems} />);
    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector("h2")?.textContent)).toEqual(["From scout"]);
    // One agent's: no browser switch, which is for all of it.
    expect(screen.queryByTestId("browser-switch")).toBeNull();
    expect(onItems).toHaveBeenLastCalledWith([expect.objectContaining({ id: "n3" }), expect.objectContaining({ id: "n1" })]);
    // An agent with none: said, by its name, else its handle.
    rerender(<ActivityView agent="wysebee" onItems={onItems} />);
    expect(await screen.findByText("No notifications from Wysebee.")).toBeTruthy();
    rerender(<ActivityView agent="gone" onItems={onItems} />);
    expect(screen.getByText("No notifications from @gone.")).toBeTruthy();
    expect(screen.queryByText("No activity yet")).toBeNull();
  });

  it("lists the notifications newest first, marks the new ones, and reads them", async () => {
    const { seen, stop } = listen();
    const f = mockFetch({
      ...AGENTS,
      [LIST]: { notifications: [note("n2", "Report ready", false, "**Done.**"), note("n1", "Earlier", true)], unread: 1 },
      [READ]: { read: 1 },
    });
    render(<ActivityView />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Notifications" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => within(r).getByRole("heading").textContent)).toEqual(["Report ready", "Earlier"]);
    expect(within(rows[0]).getByText("New")).toBeTruthy();
    expect(within(rows[1]).queryByText("New")).toBeNull();
    expect(within(rows[0]).getByText("Done.").tagName).toBe("STRONG");
    expect(rows[0].querySelector("time")?.getAttribute("dateTime")).toBe("2026-11-14T10:00:00Z");
    await waitFor(() => expect(f.to(READ)).toHaveLength(1));
    await waitFor(() => expect(seen).toContain(0));
    // A new one while open: read and shown at once; the earlier new one stays marked.
    f.set(LIST, { notifications: [note("n3", "Another", false), note("n2", "Report ready", true), note("n1", "Earlier", true)], unread: 1 });
    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread: 1 } }));
    });
    expect(await screen.findByText("Another")).toBeTruthy();
    await waitFor(() => expect(f.to(READ)).toHaveLength(2));
    expect(screen.getAllByText("New")).toHaveLength(2);
    stop();
  });

  it("deletes one with its trash button, and says why when it cannot", async () => {
    let refuse = false;
    const f = mockFetch({
      ...AGENTS,
      [LIST]: { notifications: [note("n2", "Second", true), note("n1", "First", true)], unread: 0 },
      "DELETE /api/v1/notifications/n2": () => (refuse ? reply(503, { detail: "cloud down" }) : reply(204, null)),
      "DELETE /api/v1/notifications/n1": reply(204, null),
    });
    render(<ActivityView />);
    await screen.findByText("Second");
    refuse = true;
    await userEvent.click(screen.getByRole("button", { name: "Delete “Second”" }));
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
    expect(screen.getByText("Second")).toBeTruthy();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Delete “Second”" }));
    await waitFor(() => expect(screen.queryByText("Second")).toBeNull());
    expect(screen.queryByText(/cloud down/)).toBeNull();
    expect(f.to("DELETE /api/v1/notifications/n2")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Delete “First”" }));
    expect(await screen.findByText("No activity yet")).toBeTruthy();
  });

  it("says when there is nothing yet, and nothing is read", async () => {
    const f = mockFetch({ ...AGENTS, [LIST]: { notifications: [], unread: 0 } });
    render(<ActivityView />);
    expect(await screen.findByText("No activity yet")).toBeTruthy();
    expect(f.to(READ)).toHaveLength(0);
  });

  it("says why they could not be read, before and after they were", async () => {
    const f = mockFetch({ ...AGENTS, [LIST]: reply(503, { detail: "cloud down" }) });
    const { unmount } = render(<ActivityView />);
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
    unmount();
    f.set(LIST, { notifications: [note("n1", "Earlier", true)], unread: 0 });
    render(<ActivityView />);
    expect(await screen.findByText("Earlier")).toBeTruthy();
    f.set(LIST, reply(503, { detail: "down again" }));
    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread: 1 } }));
    });
    expect(await screen.findByText(/down again/)).toBeTruthy();
    expect(screen.getByText("Earlier")).toBeTruthy();
  });
});
