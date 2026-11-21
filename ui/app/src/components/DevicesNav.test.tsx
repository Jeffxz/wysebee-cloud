import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import type { BrowserLink } from "../api";
import { resetPresence } from "../presence";
import { DevicesNav } from "./DevicesNav";

useFetchTransport();

beforeEach(() => resetPresence());

function link(over: Partial<BrowserLink> & { id: string }): BrowserLink {
  return { agent: over.id, label: over.id, browser: "Chrome", extension_version: "1.0.0", status: "connected", paused: false, last_seen: null, created_at: "2026-11-01T00:00:00Z", ...over };
}

describe("DevicesNav", () => {
  it("lists All devices, Wysebee Cloud, the devices and then the browsers, and opens one", async () => {
    mockFetch({
      "GET /api/v1/browser-links": {
        links: [
          link({ id: "b1", label: "Kim Chrome", kind: "browser", status: "offline" }),
          link({ id: "p1", label: "Kim PC", kind: "osx", browser: "KIM", agent_type: { id: "t", key: "wysebee-windows", name: "Wysebee Windows Agent" } }),
          link({ id: "a1", label: "Phone", kind: "android", paused: true }),
        ],
      },
    });
    const onSelect = vi.fn();
    render(<DevicesNav selected="p1" onSelect={onSelect} />);
    expect(screen.getByRole("navigation", { name: "Devices" })).toBeTruthy();
    const pc = await screen.findByRole("button", { name: /Kim PC/ });
    expect(pc.getAttribute("aria-current")).toBe("page");
    expect(pc.querySelector("[data-device-kind]")?.getAttribute("data-device-kind")).toBe("windows");
    hasPresence(pc, "Online");
    // Paused is not reached, and neither is a browser that is offline.
    hasPresence(screen.getByRole("button", { name: /Phone/ }), "Offline");
    hasPresence(screen.getByRole("button", { name: /Kim Chrome/ }), "Offline");
    hasPresence(screen.getByRole("button", { name: /Wysebee Cloud/ }), "Online");
    // The browsers come last, under their own heading.
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["All devices", "Wysebee Cloud", "Kim PC", "Phone", "Kim Chrome"]);
    expect(screen.getByText("Browsers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All devices" }).getAttribute("aria-current")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Kim Chrome/ }));
    expect(onSelect).toHaveBeenLastCalledWith("b1");
    await userEvent.click(screen.getByRole("button", { name: /Wysebee Cloud/ }));
    expect(onSelect).toHaveBeenLastCalledWith("cloud");
    await userEvent.click(screen.getByRole("button", { name: "All devices" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("marks All devices on the list, and has no Browsers heading without a browser", async () => {
    const f = mockFetch({ "GET /api/v1/browser-links": { links: [] } });
    render(<DevicesNav selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "All devices" }).getAttribute("aria-current")).toBe("page");
    await vi.waitFor(() => expect(f.to("GET /api/v1/browser-links").length).toBeGreaterThan(0));
    expect(screen.queryByText("Browsers")).toBeNull();
  });
});

function hasPresence(button: HTMLElement, presence: string) {
  expect(button.querySelector('[role="img"][aria-label="' + presence + '"]')).toBeTruthy();
}
