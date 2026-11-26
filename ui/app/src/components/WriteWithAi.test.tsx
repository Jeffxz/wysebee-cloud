import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply, type FakeRequest } from "../../../test/fetch";
import { resetWorkspaces } from "../workspaces";
import { WorkspacesView } from "./WorkspacesView";
import { timing } from "./WriteWithAi";
import { useFetchTransport } from "../../../test/transport";

const URL_ = "https://app.wysebee.com/assistant/mcp";
const ON = { on: true, url: URL_, path: "README.md", revision: 1, writer: "person", content: "# Docs\n", ai_client: null, ai_seen_at: null };
const saved = { ...timing };

/** Polls answered one by one, when the test says. */
function polls() {
  const waiting: ((value: unknown) => void)[] = [];
  return {
    handler: () => new Promise((resolve) => waiting.push(resolve)),
    async answer(value: unknown) {
      await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
      await act(async () => waiting.shift()!(value));
    },
    get pending() {
      return waiting.length;
    },
  };
}

beforeEach(() => {
  resetWorkspaces();
  vi.restoreAllMocks();
  Object.assign(timing, { pollWaitSeconds: 0, editDebounceMs: 10, retryMs: 10, copiedMs: 10 });
});

afterEach(() => {
  Object.assign(timing, saved);
});

useFetchTransport();

function setup(routes: Record<string, unknown> = {}, pollHandler?: (r: FakeRequest) => unknown) {
  const poll = polls();
  const f = mockFetch({
    "GET /api/v1/workspaces": { workspaces: [{ id: "p1", name: "Docs", resource_url: "x" }] },
    "GET /api/v1/workspaces/p1/files/README.md": { path: "README.md", content: "# Docs\n", size: 7 },
    "POST /api/v1/workspaces/p1/assistant": ON,
    "DELETE /api/v1/workspaces/p1/assistant": reply(204),
    ...routes,
  });
  f.set(/^GET \/api\/v1\/workspaces\/p1\/assistant\?/, pollHandler ?? poll.handler);
  const utils = render(<WorkspacesView workspace="p1" file="README.md" onOpen={vi.fn()} />);
  held = { f };
  return { f, poll, ...utils };
}

const box = () => screen.getByRole("textbox", { name: "The text of README.md" }) as HTMLTextAreaElement;

/** Always on: the page takes it once loaded (and polls for the AI app). */
let held: { f: { calls: { method: string; path: string }[] } } | null = null;
async function heldHere(posts?: number) {
  await waitFor(() => {
    const n = held!.f.calls.filter((c) => c.method === "POST" && c.path.endsWith("/assistant")).length;
    expect(posts === undefined ? n > 0 : n === posts).toBe(true);
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Use here" })).toBeNull());
}

describe("Write with AI", () => {
  it("is on once the page loads, with no switch; its info says how to use it, with the address to copy", async () => {
    const { f, poll } = setup();
    await heldHere(1);
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(f.calls.find((c) => c.method === "POST")!.body).toEqual({ path: "README.md", content: "# Docs\n" });
    // The info panel: how to use it, how to add it, and the address.
    const info = screen.getByRole("button", { name: "How to use Wysebee Assistant" });
    await userEvent.click(info);
    const panel = screen.getByRole("dialog", { name: "How to use Wysebee Assistant" });
    expect(panel.textContent).toContain("In your AI app, ask Wysebee Assistant to write what you want on this page.");
    expect(panel.textContent).toContain(URL_);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const copy = screen.getByRole("button", { name: "Copy the address" });
    const before = copy.innerHTML;
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(URL_);
    await waitFor(() => expect(copy.innerHTML).not.toBe(before));
    await waitFor(() => expect(copy.innerHTML).toBe(before));
    await userEvent.click(info);
    expect(screen.queryByRole("dialog")).toBeNull();
    // Escape, or a click outside it (not inside), closes it too.
    await userEvent.click(info);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(info);
    await userEvent.click(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("a");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.click(box());
    expect(screen.queryByRole("dialog")).toBeNull();
    // The AI app connects (no new text), then writes: the text shows, unsaved.
    await poll.answer({ ...ON, content: null, ai_client: "Claude", ai_seen_at: "2026-11-14T10:00:00Z" });
    expect(f.calls.filter((c) => c.method === "GET" && c.path.endsWith("/assistant")).slice(-1)[0].url).toContain("after=1");
    await poll.answer({ ...ON, revision: 2, writer: "ai", content: "# Plan\n", ai_client: "Claude", ai_seen_at: "2026-11-14T10:00:01Z" });
    await waitFor(() => expect(box().value).toBe("# Plan\n"));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
    // Its own text is not sent back up as the person's.
    await new Promise((r) => setTimeout(r, 30));
    expect(f.calls.some((c) => c.method === "PUT")).toBe(false);
    // An old answer (or the person's own revision) changes nothing.
    await poll.answer({ ...ON, revision: 2, writer: "ai", content: "stale", ai_client: "Claude", ai_seen_at: "x" });
    await poll.answer({ ...ON, revision: 3, writer: "person", content: "mine", ai_client: "Claude", ai_seen_at: "x" });
    expect(box().value).toBe("# Plan\n");
  });

  it("shows no address before the cloud has answered one", async () => {
    setup({ "POST /api/v1/workspaces/p1/assistant": () => new Promise(() => {}) });
    await userEvent.click(await screen.findByRole("button", { name: "How to use Wysebee Assistant" }));
    expect(screen.getByRole("dialog").textContent).not.toContain(URL_);
    expect(screen.queryByRole("button", { name: "Copy the address" })).toBeNull();
  });

  it("sends the person's typing; takes the AI app's text when it wrote since", async () => {
    let n = 0;
    const { f, poll } = setup({
      "PUT /api/v1/workspaces/p1/assistant": (r: FakeRequest) => {
        n += 1;
        const { content } = r.body as { content: string };
        if (content.endsWith("!")) return reply(409, { detail: { message: "The AI app wrote since.", ...ON, revision: 7, writer: "ai", content: "From AI" } });
        if (content.endsWith("?")) return reply(409, { detail: "Plain." });
        return { revision: 1 + n };
      },
    });
    await heldHere();
    await waitFor(() => expect(poll.pending).toBe(1));
    await userEvent.type(box(), "x");
    await waitFor(() => expect(f.calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    expect(f.calls.find((c) => c.method === "PUT")!.body).toEqual({ path: "README.md", content: "# Docs\nx", revision: 1 });
    await userEvent.type(box(), "!");
    await waitFor(() => expect(box().value).toBe("From AI"));
    await userEvent.type(box(), "?");
    expect(await screen.findByText("Plain.")).toBeTruthy();
  });

  it("says why it could not be taken, retries a failed poll, and takes it back from a page open elsewhere", async () => {
    let fails = 1;
    const later = polls();
    const { f } = setup(
      { "POST /api/v1/workspaces/p1/assistant": () => (fails-- > 0 ? reply(500, { detail: "Down." }) : ON) },
      (r) => (f.calls.filter((c) => c.url === r.url).length === 1 ? reply(502, { detail: "Gateway." }) : later.handler()),
    );
    expect(await screen.findByText("Down.")).toBeTruthy();
    // Back to the window: taken now.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await heldHere(2);
    expect(await screen.findByText("Gateway.")).toBeTruthy();
    // A page opened elsewhere took it: said so, with a way to take it back.
    await later.answer({ on: false, url: URL_ });
    expect(await screen.findByText("Your AI app is writing to a page open elsewhere.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use here" }));
    await heldHere(3);
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(3);
    // Taken elsewhere again, then back to this window (hidden first: nothing asked).
    await later.answer({ on: false, url: URL_ });
    await screen.findByRole("button", { name: "Use here" });
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(3);
    hidden.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await heldHere(4);
    expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(4);
    // Moved away: nothing here ever let the other page go.
    expect(f.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("lets it go when the page is left, but not once a page elsewhere has it", async () => {
    const held = setup();
    await heldHere();
    held.unmount();
    await waitFor(() => expect(held.f.calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    const moved = setup();
    await heldHere();
    await moved.poll.answer({ on: false, url: URL_ });
    await screen.findByRole("button", { name: "Use here" });
    moved.unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(moved.f.calls.some((c) => c.method === "DELETE")).toBe(false);
    // A failure letting it go is not shown: the page is gone.
    const failing = setup({ "DELETE /api/v1/workspaces/p1/assistant": reply(500, { detail: "No." }) });
    await heldHere();
    failing.unmount();
    await waitFor(() => expect(failing.f.calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
  });

  it("stops polling when the page is left mid-wait or mid-retry", async () => {
    const first = setup({}, () => reply(500, { detail: "x" }));
    expect(await screen.findByText("x")).toBeTruthy();
    first.unmount();
    for (const late of [{ ...ON, revision: 9, writer: "ai", content: "late" }, reply(500, { detail: "late" })]) {
      const next = setup();
      await heldHere();
      next.unmount();
      await next.poll.answer(late);
    }
  });
});
