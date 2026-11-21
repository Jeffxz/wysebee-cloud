import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { resetAgents } from "../../agents";
import type { BrowserLink } from "../../api";
import { BROWSERS_REFRESH_MS } from "./BrowsersSection";
import { ago, DesktopsSection } from "./DesktopsSection";
import { dialogs } from "../common/confirm";

useFetchTransport();

const LIST = "GET /api/v1/browser-links";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function link(over: Partial<BrowserLink> & { id: string }): BrowserLink {
  return { agent: over.id, label: over.id, browser: "Mac mini", extension_version: "0.1.0", status: "connected", paused: false, last_seen: minutesAgo(0), created_at: minutesAgo(600), kind: "osx", ...over };
}

beforeEach(() => resetAgents());
afterEach(() => vi.useRealTimers());

describe("ago", () => {
  it("says how long ago, in the largest unit that fits", () => {
    const now = new Date("2026-10-25T12:00:00Z");
    expect(ago("2026-10-25T11:59:40Z", now, "en")).toBe("this minute");
    expect(ago("2026-10-25T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(ago("2026-10-25T09:00:00Z", now, "en")).toBe("3 hours ago");
    expect(ago("2026-10-24T11:00:00Z", now, "en")).toBe("yesterday");
  });
});

describe("DesktopsSection", () => {
  it("lists Wysebee Cloud, then the Macs running an agent — no browser, and no desktop", async () => {
    const links = [
      link({ id: "l1", agent: "sky", label: "Sky", kind: "browser", browser: "Chrome" }),
      link({ id: "m1", agent: "mini", label: "Mini", browser: "Jo's Mac mini", approved: ["say"] }),
      link({ id: "m2", agent: "book", label: "Book", browser: "MacBook", extension_version: "", status: "offline", paused: true, last_seen: minutesAgo(5) }),
    ];
    const f = mockFetch({
      [LIST]: () => ({ links }),
      "GET /agent/agents": { rows: [] },
      "POST /api/v1/browser-links/m1/unpair": () => {
        links.splice(1, 1);
        return reply(204);
      },
    });
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    const onOpenDevice = vi.fn();
    render(<DesktopsSection onOpenDevice={onOpenDevice} onOpenAgent={vi.fn()} />);
    expect(screen.getByText("Reading your devices…")).toBeTruthy();
    const mini = (await screen.findByText("Mini")).closest("li") as HTMLElement;
    expect(within(mini).getByText("@mini")).toBeTruthy();
    expect(within(mini).getByText("Jo's Mac mini · Wysebee Agent 0.1.0")).toBeTruthy();
    expect(within(mini).getByText("Connected")).toBeTruthy();
    const book = screen.getByText("Book").closest("li") as HTMLElement;
    expect(within(book).getByText("Offline — last seen 5 minutes ago")).toBeTruthy();
    expect(within(book).getByText("Paused")).toBeTruthy();
    expect(screen.queryByText("Sky")).toBeNull();
    expect(f.to("GET /api/v1/desktops")).toHaveLength(0);
    // Wysebee Cloud first, always connected on the web.
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Wysebee Cloud")).toBeTruthy();
    expect(within(rows[0]).getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Your devices")).toBeTruthy();
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    // A name opens that device's page; Wysebee Cloud's, its own.
    await userEvent.click(within(mini).getByRole("button", { name: "Mini" }));
    expect(onOpenDevice).toHaveBeenLastCalledWith("m1");
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Wysebee Cloud" }));
    expect(onOpenDevice).toHaveBeenLastCalledWith("cloud");
    // Unpaired after asking, in a Mac's own words.
    await userEvent.click(within(mini).getByRole("button", { name: "Unpair" }));
    expect(confirm).toHaveBeenCalledWith("Unpair Jo's Mac mini from Mini? The agent stays, and can no longer run programs on that Mac. To use it again, pair a Mac and reconnect it to this agent when Wysebee asks.", expect.anything());
    expect(f.to("POST /api/v1/browser-links/m1/unpair")).toHaveLength(0);
    await userEvent.click(within(mini).getByRole("button", { name: "Unpair" }));
    await waitFor(() => expect(screen.queryByText("Mini")).toBeNull());
  });

  it("says when no device runs an agent, or why the list could not be read, and reads it again on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let answer: unknown = reply(401);
    mockFetch({ [LIST]: () => answer });
    render(<DesktopsSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    expect(await screen.findByText("Sign in to see your browsers.")).toBeTruthy();
    answer = { links: [link({ id: "l1", kind: "browser" })] };
    await act(async () => {
      vi.advanceTimersByTime(BROWSERS_REFRESH_MS);
    });
    expect(await screen.findByText("No device runs one of your agents yet.")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("pairs a Mac on the website (2026-11-13), then lists it and offers its agent", async () => {
    const links: BrowserLink[] = [];
    const mac = link({ id: "m1", agent: "studio", label: "Studio", browser: "Jo's MacBook" });
    const f = mockFetch({
      [LIST]: () => ({ links }),
      "GET /agent/agents": { rows: [] },
      "POST /api/v1/browser-links/claim": () => {
        links.push(mac);
        return { link: mac, agent: { name: "studio", label: "Studio" } };
      },
    });
    const onOpenAgent = vi.fn();
    render(<DesktopsSection onOpenDevice={vi.fn()} onOpenAgent={onOpenAgent} />);
    expect(await screen.findByText("No device runs one of your agents yet.")).toBeTruthy();
    expect(screen.getByText(/Pair a device here: its agent lives in Wysebee Cloud/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pair a device" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pair a Mac" }));
    const dialog = screen.getByRole("dialog", { name: "Pair a Mac" });
    await userEvent.type(within(dialog).getByLabelText("Pairing code"), "ABCD-EFGH{Enter}");
    expect(await within(dialog).findByText("Studio (@studio) was created and uses Jo's MacBook.")).toBeTruthy();
    // Listed at once, after Wysebee Cloud; the agents are read again too.
    await waitFor(() => expect(screen.getAllByText("Studio").length).toBeGreaterThan(0));
    expect(f.to("GET /agent/agents").length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Open its settings" }));
    expect(onOpenAgent).toHaveBeenCalledWith("studio");
    expect(screen.queryByRole("dialog")).toBeNull();
    // Closed without pairing: nothing else happens.
    await userEvent.click(screen.getByRole("button", { name: "Pair a device" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Pair a Mac" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers a Mac, a Windows PC or an Android phone, and lists PCs and phones as devices (2026-11-16)", async () => {
    const links = [
      link({ id: "w1", agent: "tower", label: "Tower", browser: "Jo's PC", agent_type: { id: "t4", key: "wysebee-windows", name: "Wysebee Windows Agent" } }),
      link({ id: "a1", agent: "pixel", label: "Pixel", browser: "Pixel 9", kind: "android", agent_type: { id: "t5", key: "wysebee-android", name: "Wysebee Android Agent" } }),
    ];
    mockFetch({
      [LIST]: () => ({ links }),
      "GET /agent/agents": { rows: [] },
      "GET /api/v1/agent-types": { types: [] },
      "POST /api/v1/browser-links/a1/unpair": () => reply(204),
    });
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValue(false);
    render(<DesktopsSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    const tower = (await screen.findByText("Tower")).closest("li") as HTMLElement;
    const pixel = screen.getByText("Pixel").closest("li") as HTMLElement;
    expect(within(pixel).getByText("Wysebee Android Agent · Pixel 9 · Wysebee Agent 0.1.0")).toBeTruthy();
    await userEvent.click(within(tower).getByRole("button", { name: "Unpair" }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("can no longer run programs on that PC"), expect.anything());
    await userEvent.click(within(pixel).getByRole("button", { name: "Unpair" }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining("can no longer use that phone"), expect.anything());

    const menu = screen.getByRole("button", { name: "Pair a device" });
    await userEvent.click(menu);
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Pair a Mac", "Pair a Windows PC", "Pair a Linux machine", "Pair an Android phone"]);
    // A click outside closes it, and so does Escape inside it.
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(menu);
    screen.getByRole("menuitem", { name: "Pair a Mac" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole("menuitem", { name: "Pair a Windows PC" }));
    expect(within(screen.getByRole("dialog", { name: "Pair a Windows PC" })).getByText("Install and open Wysebee Agent on the PC.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole("menuitem", { name: "Pair a Linux machine" }));
    expect(within(screen.getByRole("dialog", { name: "Pair a Linux machine" })).getByText("Run wysebee-agent pair there with a name for the agent that will use this machine.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole("menuitem", { name: "Pair an Android phone" }));
    expect(screen.getByRole("dialog", { name: "Pair an Android phone" })).toBeTruthy();
  });
});
