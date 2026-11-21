import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { POLL_MS } from "../../reminders";
import { RemindersList } from "./Reminders";
import { useFetchTransport } from "../../../../test/transport";

useFetchTransport();

const reminder = (id: string, text: string, due_at = "2099-03-01T14:30:00+00:00") => ({ id, text, due_at, created_at: null, delivered_at: null });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RemindersList", () => {
  it("shows nothing while there are none, or when they cannot be read", async () => {
    const api = mockFetch({ "GET /api/v1/reminders": { reminders: [] } });
    const { container, unmount } = render(<RemindersList />);
    await waitFor(() => expect(api.to("GET /api/v1/reminders")).toHaveLength(1));
    expect(container.innerHTML).toBe("");
    unmount();
    mockFetch({ "GET /api/v1/reminders": reply(500, { detail: "down" }) });
    const second = render(<RemindersList />);
    await new Promise((r) => setTimeout(r, 10));
    expect(second.container.innerHTML).toBe("");
  });

  it("lists those to come with when they are due, and cancels one", async () => {
    const api = mockFetch({
      "GET /api/v1/reminders": { reminders: [reminder("r1", "Walk dog"), reminder("r2", "Call Mum")] },
      "DELETE /api/v1/reminders/r1": { __reply: true, status: 204 },
    });
    render(<RemindersList />);
    expect(await screen.findByRole("heading", { name: "Reminders" })).toBeTruthy();
    expect(screen.getByText("Walk dog")).toBeTruthy();
    expect(screen.getByText("Call Mum")).toBeTruthy();
    expect(screen.getAllByText(/Mar 1/)).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Cancel the reminder “Walk dog”" }));
    await waitFor(() => expect(screen.queryByText("Walk dog")).toBeNull());
    expect(api.to("DELETE /api/v1/reminders/r1")).toHaveLength(1);
    expect(screen.getByText("Call Mum")).toBeTruthy();
  });

  it("says why a cancel failed, as text when not an Error", async () => {
    const error = vi.spyOn(toast, "error").mockImplementation(() => "");
    const api = mockFetch({
      "GET /api/v1/reminders": { reminders: [reminder("r1", "Walk dog")] },
      "DELETE /api/v1/reminders/r1": reply(404, { detail: "No such reminder is still to come." }),
    });
    render(<RemindersList />);
    const cancel = await screen.findByRole("button", { name: "Cancel the reminder “Walk dog”" });
    await userEvent.click(cancel);
    await waitFor(() => expect(error).toHaveBeenCalledWith("No such reminder is still to come."));
    api.set("DELETE /api/v1/reminders/r1", () => Promise.reject("offline"));
    await waitFor(() => expect((cancel as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(cancel);
    await waitFor(() => expect(error).toHaveBeenCalledWith("offline"));
    expect(screen.getByText("Walk dog")).toBeTruthy();
  });

  it("reads them again every poll, and stops when it goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let list = [reminder("r1", "Walk dog")];
    let late: (() => void) | null = null;
    const api = mockFetch({
      "GET /api/v1/reminders": () => (late ? new Promise((r) => (late = () => r({ reminders: list }))) : { reminders: list }),
    });
    const { unmount } = render(<RemindersList />);
    expect(await screen.findByText("Walk dog")).toBeTruthy();
    // Delivered to Chat meanwhile: it leaves the list at the next read.
    list = [];
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    await waitFor(() => expect(screen.queryByText("Walk dog")).toBeNull());
    // A read still out when the list goes changes nothing.
    late = () => {};
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS));
    const reads = api.to("GET /api/v1/reminders").length;
    unmount();
    await act(async () => late?.());
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(api.to("GET /api/v1/reminders")).toHaveLength(reads);
  });
});
