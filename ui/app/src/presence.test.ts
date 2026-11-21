import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserLink } from "./api";

const api = vi.hoisted(() => ({ fetchBrowserLinks: vi.fn(async () => ({ links: [] as BrowserLink[] })) }));
vi.mock("./api", () => api);

import { PRESENCE_REFRESH_MS, presenceOf, refreshLinks, resetPresence, useLinks } from "./presence";

const link = (agent: string, status: BrowserLink["status"], paused = false, kind?: BrowserLink["kind"]) => ({ agent, status, paused, kind }) as BrowserLink;

describe("presence", () => {
  afterEach(() => {
    resetPresence();
    vi.useRealTimers();
  });

  it("is online for an agent living in Wysebee Cloud, links read or not", () => {
    expect(presenceOf({ name: "sky" }, null)).toBe("online");
    expect(presenceOf({ name: "sky" }, [link("sky", "offline")])).toBe("online");
  });

  it("puts a browser's agent online only while its extension polls and is not paused", () => {
    const all = [link("shelf", "connected"), link("nap", "connected", true), link("shut", "offline"), link("mac", "connected", false, "osx")];
    const browser = (name: string, links: BrowserLink[] | null = all) => presenceOf({ name, browser: true }, links);
    expect(browser("shelf")).toBe("online");
    expect(browser("nap")).toBe("offline");
    expect(browser("shut")).toBe("offline");
    expect(browser("mac")).toBe("offline");
    expect(browser("gone")).toBe("offline");
    expect(browser("shelf", null)).toBeNull();
  });

  it("puts a device's agent online only while its Mac, PC or phone polls and is not paused", () => {
    const all = [link("studio", "connected", false, "osx"), link("desk", "offline", false, "osx"), link("pocket", "connected", true, "android"), link("tab", "connected")];
    const device = (name: string, links: BrowserLink[] | null = all) => presenceOf({ name, device: "wysebee-osx" }, links);
    expect(device("studio")).toBe("online");
    expect(device("desk")).toBe("offline");
    expect(device("pocket")).toBe("offline");
    // A browser's link is not its device's; a device no longer listed is offline.
    expect(device("tab")).toBe("offline");
    expect(device("gone")).toBe("offline");
    expect(device("studio", null)).toBeNull();
  });

  it("reads the links, again every 30 s while shown, keeping the last list on a failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.fetchBrowserLinks.mockResolvedValueOnce({ links: [link("shelf", "connected")] });
    const { result, unmount } = renderHook(() => useLinks());
    await waitFor(() => expect(result.current).toHaveLength(1));
    api.fetchBrowserLinks.mockResolvedValueOnce({ links: [] });
    await act(async () => {
      vi.advanceTimersByTime(PRESENCE_REFRESH_MS);
    });
    await waitFor(() => expect(result.current).toEqual([]));
    api.fetchBrowserLinks.mockRejectedValueOnce(new Error("offline"));
    await refreshLinks();
    expect(result.current).toEqual([]);
    unmount();
    // A second watcher starts its own reads again.
    api.fetchBrowserLinks.mockResolvedValue({ links: [link("nap", "offline")] });
    const again = renderHook(() => useLinks());
    await waitFor(() => expect(again.result.current).toHaveLength(1));
    again.unmount();
  });
});
