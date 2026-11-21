import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "../../i18n";
import { mockFetch } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { resetAgents } from "../../agents";
import type { Task } from "../../api";
import { ScheduleCard, useScheduleText } from "./ScheduleCard";

const task = (over: Partial<Task>): Task => ({
  id: "t1",
  name: "Morning",
  prompt: "",
  description: "",
  label: "",
  browser_access: false,
  browser: "",
  browser_devtools: false,
  trigger: { type: "manual" },
  next_run_at: null,
  creator: null,
  created_at: null,
  updated_at: null,
  last_run: null,
  ...over,
});

describe("useScheduleText", () => {
  it("says when a task runs, in words", () => {
    const { result } = renderHook(() => useScheduleText());
    const say = result.current;
    expect(say({ type: "manual" })).toBe("Runs only when started");
    expect(say({ type: "once" })).toBe("Runs only when started");
    expect(say({ type: "once", at: "2026-11-16T14:00:00Z" })).toMatch(/^Once, Nov 16, 2026/);
    expect(say({ type: "recurring", repeat: "minutes", every: 30 })).toBe("Every 30 minutes");
    expect(say({ type: "recurring", repeat: "hours", every: 1 })).toBe("Every hour");
    expect(say({ type: "recurring", repeat: "hours" })).toBe("Every 0 hours");
    expect(say({ type: "recurring", repeat: "daily", time: "09:00", tz: "America/Toronto" })).toBe("Every day at 09:00 (America/Toronto)");
    expect(say({ type: "recurring", repeat: "daily", time: "09:00" })).toBe("Every day at 09:00 (UTC)");
    expect(say({ type: "recurring", repeat: "weekly", time: "07:30", days: [1, 5] })).toBe("Every Mon, Fri at 07:30 (UTC)");
    expect(say({ type: "recurring", repeat: "weekly", time: "07:30" })).toBe("Every  at 07:30 (UTC)");
  });
});

useFetchTransport();
beforeEach(() => resetAgents());

describe("ScheduleCard", () => {
  it("shows when it runs, when it is next due, and its steps in order, each agent by its handle now", async () => {
    mockFetch({ "GET /agent/agents": { rows: [{ id: "s1", agent_name: "scout", updated_at: null }, { id: "w", agent_name: "wysebee", updated_at: null }] } });
    render(
      <ScheduleCard
        task={task({
          trigger: { type: "recurring", repeat: "daily", time: "09:00", tz: "UTC" },
          next_run_at: "2026-11-16T09:00:00Z",
          steps: [{ agent_id: "s1", tool: "browser_screenshot", arguments: { url: "https://x" } }, { agent_id: "w", tool: "load_skill", arguments: {} }, { agent_id: "gone", tool: "list" }],
        })}
      />,
    );
    const card = screen.getByRole("region", { name: "Schedule" });
    expect(within(card).getByText("Every day at 09:00 (UTC)")).toBeTruthy();
    expect(within(card).getByText(/^Next: Nov 16, 2026/)).toBeTruthy();
    const steps = () => within(card).getAllByRole("listitem").map((li) => li.textContent);
    // While the agents are read: not yet named.
    expect(steps()[0]).toBe('… · browser_screenshot{"url":"https://x"}');
    await waitFor(() => expect(steps()).toEqual(['@scout · browser_screenshot{"url":"https://x"}', "@wysebee · load_skill", "a deleted agent · list"]));
  });

  it("says when it is not scheduled and has no steps", () => {
    render(<ScheduleCard task={task({})} />);
    expect(screen.getByText("Not scheduled")).toBeTruthy();
    expect(screen.getByText(/No steps: when it's due/)).toBeTruthy();
  });
});
