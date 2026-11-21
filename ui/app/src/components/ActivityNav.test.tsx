import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { loadAgents, resetAgents } from "../agents";
import type { ActivityNotification } from "../api";
import { ActivityNav } from "./ActivityNav";

useFetchTransport();
beforeEach(() => resetAgents());

const note = (id: string, agent: string | null) => ({ id, title: id, body: "", agent, created_at: "2026-11-14T10:00:00Z", read: true }) as ActivityNotification;

describe("ActivityNav", () => {
  it("lists All activity, then each agent that sent some with how many, and shows one's", async () => {
    mockFetch({
      "GET /agent/agents": { rows: [{ agent_name: "wysebee", label: "Wysebee", updated_at: null }, { agent_name: "scout", label: "Scout", avatar: "🧭", updated_at: null }, { agent_name: "quiet", label: "Quiet", updated_at: null }] },
    });
    await loadAgents();
    const onSelect = vi.fn();
    render(<ActivityNav items={[note("n1", "scout"), note("n2", "zed"), note("n3", "scout"), note("n4", null), note("n5", "wysebee"), note("n6", "abe")]} selected="scout" onSelect={onSelect} />);
    expect(screen.getByRole("navigation", { name: "Activity" })).toBeTruthy();
    // Wysebee first, then by name; one no longer there by its handle; none that sent nothing.
    await waitFor(() => expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["All activity6", "Wysebee1", "🧭Scout2", "@abe1", "@zed1"]));
    expect(screen.getByRole("button", { name: /Scout/ }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: /All activity/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("list").hasAttribute("data-track-private")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: /@zed/ }));
    expect(onSelect).toHaveBeenLastCalledWith("zed");
    await userEvent.click(screen.getByRole("button", { name: /All activity/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("marks All activity, with no count and no agents until the page has read them", () => {
    render(<ActivityNav items={null} selected={null} onSelect={vi.fn()} />);
    const all = screen.getByRole("button", { name: "All activity" });
    expect(all.getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
