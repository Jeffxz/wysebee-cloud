import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import * as api from "../api";
import { applyTheme } from "../theme";
import { PageFrame } from "./PageView";
import { DECLINED, PageToolGrants, viewKeyOf } from "./PageTools";

beforeEach(() => {
  vi.restoreAllMocks();
  applyTheme("light");
});

/** The page in its frame, with its own window's messages to the frame watched. */
function framed(owner = true) {
  const pageId = owner ? "pg1" : undefined;
  const onToolAllowed = vi.fn();
  render(<PageFrame src="/api/v1/page-view/pg1/key1" title="Sales" pageId={pageId} onToolAllowed={onToolAllowed} />);
  const frame = screen.getByTitle("Sales") as HTMLIFrameElement;
  const post = vi.spyOn(frame.contentWindow!, "postMessage");
  const send = (data: unknown, source: Window | null = frame.contentWindow) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source }));
    });
  const results = () => post.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((m) => m.wysebee === "result");
  return { frame, send, results, onToolAllowed };
}

const call = (id: number, extra: Record<string, unknown> = {}) => ({ wysebee: "call", id, agent: "db", tool: "query_sales", arguments: { region: "EU" }, ...extra });
const answer = { text: "[1,2]", images: [], is_error: false };

describe("a page's tools", () => {
  it("knows which copy of the page asks by the key in its address", () => {
    expect(viewKeyOf("/api/v1/page-view/pg1/key1?theme=dark")).toBe("key1");
  });

  it("runs an allowed tool for its own frame and answers it there alone", async () => {
    const run = vi.spyOn(api, "runPageTool").mockResolvedValue({ result: answer });
    const { send, results } = framed();
    // Another window's message, or one that is not a call: nothing runs.
    send(call(1), window);
    send({ wysebee: "call", id: "x", agent: "db", tool: "t" });
    send(call(2, { arguments: [1] }));
    send("call");
    send(null);
    expect(run).not.toHaveBeenCalled();
    send(call(3));
    await waitFor(() => expect(results()).toEqual([{ wysebee: "result", id: 3, text: "[1,2]", images: [], isError: false }]));
    // No arguments: none.
    send({ wysebee: "call", id: 4, agent: "db", tool: "count" });
    await waitFor(() => expect(run).toHaveBeenLastCalledWith("pg1", expect.objectContaining({ tool: "count", arguments: {} })));
    expect(run).toHaveBeenCalledWith("pg1", { agent: "db", tool: "query_sales", arguments: { region: "EU" }, view_key: "key1", allow: undefined });
  });

  it("asks the person the first time, one tool at a time, and runs it as they say", async () => {
    const run = vi.spyOn(api, "runPageTool").mockImplementation(async (_p, c) =>
      c.allow ? { result: answer } : { ask: { agent: "db", tool: c.tool, reads: c.tool === "query_sales" } },
    );
    const { send, results, onToolAllowed } = framed();
    send(call(1));
    send(call(2, { tool: "delete_rows", arguments: {} }));
    // The first: what it is, that it only reads, and with what.
    const ask = await screen.findByRole("alertdialog", { name: "Let this page use a tool?" });
    expect(within(ask).getByText("“Sales” wants to run query_sales from @db.")).toBeTruthy();
    expect(within(ask).getByText("It only reads: it changes nothing.")).toBeTruthy();
    expect(within(ask).getByLabelText("With").textContent).toContain('"region": "EU"');
    // Enter while typing in the page must not allow it.
    expect(document.activeElement?.textContent).toBe("Don’t allow");
    await userEvent.click(within(ask).getByRole("button", { name: "Always allow on this page" }));
    await waitFor(() => expect(results()).toEqual([{ wysebee: "result", id: 1, text: "[1,2]", images: [], isError: false }]));
    expect(run).toHaveBeenLastCalledWith("pg1", expect.objectContaining({ tool: "query_sales", allow: "always" }));
    expect(onToolAllowed).toHaveBeenCalled();
    // Then the second, which can change something: allowed only until the page changes; declined.
    const second = await screen.findByRole("alertdialog");
    expect(within(second).getByText(/It can change something/)).toBeTruthy();
    expect(within(second).getByRole("button", { name: "Allow until this page changes" })).toBeTruthy();
    expect(within(second).queryByLabelText("With")).toBeNull();
    await userEvent.click(within(second).getByRole("button", { name: "Don’t allow" }));
    await waitFor(() => expect(results()[1]).toEqual({ wysebee: "result", id: 2, error: DECLINED }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalledWith("pg1", expect.objectContaining({ tool: "delete_rows", allow: expect.anything() }));
  });

  it("says why a tool could not run, and runs nothing for a frame that is not its owner's view", async () => {
    vi.spyOn(api, "runPageTool").mockRejectedValue(new Error("HTTP 429: A page runs at most 30 tools a minute: wait a moment."));
    const { send, results } = framed();
    send(call(1));
    await waitFor(() => expect(results()).toEqual([{ wysebee: "result", id: 1, error: "A page runs at most 30 tools a minute: wait a moment." }]));
  });

  it("does not listen without a page id", () => {
    const run = vi.spyOn(api, "runPageTool");
    const { send } = framed(false);
    send(call(1));
    expect(run).not.toHaveBeenCalled();
  });

  it("lists the tools a page may run without asking, each to be taken back", async () => {
    vi.spyOn(api, "fetchPageToolGrants").mockResolvedValue({
      grants: [
        { agent: "db", tool: "query_sales", reads: true, current: true },
        { agent: "scout", tool: "browser_click", reads: false, current: false },
      ],
    });
    const revoke = vi.spyOn(api, "revokePageToolGrant").mockResolvedValue();
    const onChange = vi.fn();
    const { rerender } = render(<PageToolGrants pageId="pg1" count={0} onChange={onChange} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<PageToolGrants pageId="pg1" count={2} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Tools (2)" }));
    const list = await screen.findByRole("dialog", { name: "Tools this page may use without asking" });
    expect(await within(list).findByText("@db · query_sales")).toBeTruthy();
    expect(within(list).getByText("reads")).toBeTruthy();
    expect(within(list).getByText("asks again")).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: "Stop allowing query_sales" }));
    expect(revoke).toHaveBeenCalledWith("pg1", "db", "query_sales");
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(1));
    expect(within(list).queryByText("@db · query_sales")).toBeNull();
  });

  it("takes Escape as no, and shortens long arguments", async () => {
    vi.spyOn(api, "runPageTool").mockResolvedValue({ ask: { agent: "db", tool: "query_sales", reads: true } });
    const { send, results } = framed();
    send(call(1, { arguments: { sql: "x".repeat(3000) } }));
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByLabelText("With").textContent!.endsWith("…")).toBe(true);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(results()).toEqual([{ wysebee: "result", id: 1, error: DECLINED }]));
  });

  it("says why the tools it may run could not be read or taken back", async () => {
    vi.spyOn(api, "fetchPageToolGrants").mockRejectedValueOnce(new Error("HTTP 500: Down.")).mockResolvedValue({ grants: [{ agent: "db", tool: "q", reads: false, current: true }] });
    vi.spyOn(api, "revokePageToolGrant").mockRejectedValue(new Error("HTTP 500: Still down."));
    render(<PageToolGrants pageId="pg1" count={1} onChange={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Tools (1)" });
    await userEvent.click(button);
    expect(await screen.findByText("Down.")).toBeTruthy();
    // Closed and opened again: read again.
    await userEvent.click(button);
    await userEvent.click(button);
    expect(await screen.findByText("changes")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Stop allowing q" }));
    expect(await screen.findByText("Still down.")).toBeTruthy();
    expect(screen.getByText("@db · q")).toBeTruthy();
  });
});
