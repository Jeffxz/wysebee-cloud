import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { agentsNow, resetAgents } from "../../agents";
import type { BrowserLink } from "../../api";
import { BROWSERS_REFRESH_MS, BrowsersSection } from "./BrowsersSection";
import { dialogs } from "../common/confirm";

useFetchTransport();

const LIST = "GET /api/v1/browser-links";
const AGENTS = "GET /agent/agents";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function link(over: Partial<BrowserLink> & { id: string }): BrowserLink {
  return { agent: over.id, label: over.id, browser: "Chrome", extension_version: "1.0.0", status: "connected", paused: false, last_seen: minutesAgo(0), created_at: minutesAgo(600), ...over };
}

beforeEach(() => resetAgents());
afterEach(() => vi.useRealTimers());

describe("BrowsersSection", () => {
  it("lists the paired browsers with their agents, connected, offline or paused", async () => {
    mockFetch({
      [LIST]: {
        links: [
          link({ id: "l1", agent: "sky", label: "Sky", agent_type: { id: "t1", key: "wysebee-browser-chrome", name: "Wysebee Chrome Agent" } }),
          link({ id: "l2", agent: "work", label: "Work", browser: "Edge", extension_version: "", status: "offline", paused: true, last_seen: minutesAgo(5) }),
          link({ id: "l3", agent: "new", label: "New", status: "offline", last_seen: null }),
        ],
      },
    });
    const onOpenDevice = vi.fn();
    render(<BrowsersSection onOpenDevice={onOpenDevice} onOpenAgent={vi.fn()} />);
    expect(screen.getByText("Reading your browsers…")).toBeTruthy();
    const sky = (await screen.findByText("Sky")).closest("li") as HTMLElement;
    expect(within(sky).getByText("@sky")).toBeTruthy();
    // Its agent type's name first (2026-11-13, later), when the cloud says one.
    expect(within(sky).getByText("Wysebee Chrome Agent · Chrome · Wysebee Agent 1.0.0")).toBeTruthy();
    expect(within(sky).getByText("Connected")).toBeTruthy();
    expect(within(sky).queryByText("Paused")).toBeNull();
    const work = screen.getByText("Work").closest("li") as HTMLElement;
    expect(within(work).getByText("Edge")).toBeTruthy();
    expect(within(work).getByText("Offline — last seen 5 minutes ago")).toBeTruthy();
    expect(within(work).getByText("Paused")).toBeTruthy();
    expect(within(screen.getByText("New").closest("li") as HTMLElement).getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Browsers")).toBeTruthy();
    // The names are the person's own: never a click label.
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    // A name opens that browser's page.
    await userEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(onOpenDevice).toHaveBeenCalledWith("l2");
  });

  it("unpairs one after asking, reads the agents again, and shows a refusal", async () => {
    let refuse: false | "reply" | "throw" = false;
    const links = [link({ id: "l1", agent: "sky", label: "Sky" })];
    const f = mockFetch({
      [LIST]: () => ({ links }),
      [AGENTS]: { rows: [{ agent_name: "sky", label: "Sky", updated_at: null }] },
      "POST /api/v1/browser-links/l1/unpair": () => {
        if (refuse === "throw") throw "offline";
        if (refuse) return reply(404, { detail: { code: "browser_unpaired", message: "No such browser." } });
        links.length = 0;
        return reply(204);
      },
    });
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const confirm = vi.spyOn(dialogs, "confirm").mockResolvedValueOnce(false).mockResolvedValue(true);
    render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Unpair" }));
    expect(confirm).toHaveBeenCalledWith("Unpair Chrome from Sky? The agent stays, without a browser. To use it again, pair a browser and reconnect it to this agent when Wysebee asks.", expect.anything());
    expect(f.to("POST /api/v1/browser-links/l1/unpair")).toHaveLength(0);
    refuse = "reply";
    await userEvent.click(screen.getByRole("button", { name: "Unpair" }));
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("No such browser."));
    refuse = "throw";
    await userEvent.click(screen.getByRole("button", { name: "Unpair" }));
    await waitFor(() => expect(error).toHaveBeenLastCalledWith("offline"));
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Unpair" }));
    expect(await screen.findByText("No browser is paired yet.")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    await waitFor(() => expect(agentsNow()?.map((a) => a.name)).toEqual(["sky"]));
  });

  it("leaves the Macs, PCs and phones to Your devices", async () => {
    mockFetch({ [LIST]: { links: [link({ id: "m1", agent: "mini", label: "Mini", kind: "osx", browser: "Mac mini" }), link({ id: "a1", agent: "pixel", label: "Pixel", kind: "android", browser: "Pixel 9" })] } });
    render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    expect(await screen.findByText("No browser is paired yet.")).toBeTruthy();
    expect(screen.queryByText("Mini")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("pairs a browser in its dialog, shows it and its agent, and opens the agent's settings", async () => {
    const links: BrowserLink[] = [];
    const rows: { agent_name: string; label: string; updated_at: null }[] = [];
    mockFetch({
      [LIST]: () => ({ links }),
      [AGENTS]: () => ({ rows }),
      "POST /api/v1/browser-links/claim": () => {
        links.push(link({ id: "l1", agent: "sky", label: "Sky" }));
        rows.push({ agent_name: "sky", label: "Sky", updated_at: null });
        return { link: links[0], agent: { name: "sky", label: "Sky" } };
      },
    });
    const onOpenAgent = vi.fn();
    render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={onOpenAgent} />);
    expect(await screen.findByText("No browser is paired yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Pair a browser" }));
    const dialog = screen.getByRole("dialog", { name: "Pair a browser" });
    // Closed and opened again.
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Pair a browser" }));
    await userEvent.type(screen.getByLabelText("Pairing code"), "abcd-efgh{Enter}");
    expect(await screen.findByText("Sky (@sky) now uses that browser.")).toBeTruthy();
    // The list behind it and Home's agents have the new one.
    expect(await screen.findByText("@sky")).toBeTruthy();
    await waitFor(() => expect(agentsNow()?.map((a) => a.name)).toEqual(["sky"]));
    await userEvent.click(screen.getByRole("button", { name: "Open its settings" }));
    expect(onOpenAgent).toHaveBeenCalledWith("sky");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says to sign in when signed out, and why the list could not be read", async () => {
    const f = mockFetch({ [LIST]: reply(401, { detail: "Sign in." }) });
    const { unmount } = render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    expect(await screen.findByText("Sign in to see your browsers.")).toBeTruthy();
    expect(screen.queryByText("Reading your browsers…")).toBeNull();
    unmount();
    f.set(LIST, reply(502, { detail: "cloud down" }));
    const second = render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    expect(await screen.findByText(/cloud down/)).toBeTruthy();
    second.unmount();
    f.set(LIST, () => {
      throw "offline";
    });
    render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    expect(await screen.findByText("offline")).toBeTruthy();
  });

  it("reads the list again every half minute while it shows", async () => {
    vi.useFakeTimers();
    const f = mockFetch({ [LIST]: { links: [] } });
    const { unmount } = render(<BrowsersSection onOpenDevice={vi.fn()} onOpenAgent={vi.fn()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(f.to(LIST)).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSERS_REFRESH_MS);
    });
    expect(f.to(LIST)).toHaveLength(2);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BROWSERS_REFRESH_MS);
    });
    expect(f.to(LIST)).toHaveLength(2);
  });
});
