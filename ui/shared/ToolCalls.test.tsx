import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/src/i18n";
import {
  chatItems,
  looksLikeMarkdown,
  Output,
  TextCopierContext,
  ToolCalls,
  type ToolStep,
} from "./ToolCalls";

const labels = {
  used: (n: number) => `Used ${n} tools`,
  failed: (n: number) => `${n} failed`,
  error: "failed",
  notRun: "not run",
  noOutput: "No output",
  copy: "Copy",
  copied: "Copied",
};

describe("chatItems", () => {
  it("joins calls across tool rounds until something is said, results attached", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "", tool_calls: [{ id: "a", name: "browser_tabs" }] },
      { role: "tool", tool_call_id: "a", content: "[]" },
      { role: "assistant", tool_calls: [{ id: "b", name: "browser_screenshot" }] },
      { role: "tool", tool_call_id: "b", is_error: true },
      { role: "tool", content: "orphan" },
      { role: "assistant", content: "Done", tool_calls: [{ id: "c", name: "browser_click" }] },
      { role: "assistant" },
      { role: "user", content: "next" },
    ];
    const items = chatItems(messages);
    expect(items.map((i) => (i.kind === "message" ? `m${i.index}` : `t:${i.key}`))).toEqual([
      "m0",
      "t:a",
      "m6",
      "t:c",
      "m8",
    ]);
    const run = items[1];
    if (run.kind !== "tools") throw new Error("expected tools");
    expect(run.steps).toEqual([
      { id: "a", name: "browser_tabs", result: { content: "[]", is_error: undefined } },
      { id: "b", name: "browser_screenshot", result: { content: "", is_error: true } },
    ]);
    const pending = items[3];
    expect(pending.kind === "tools" && pending.steps[0].result).toBeUndefined();
    expect(chatItems([{ role: "assistant", tool_calls: [{ id: "x", name: "t" }] }])).toHaveLength(1);
  });
});

describe("ToolCalls", () => {
  it("shows a lone call as one row that opens to its output", async () => {
    render(<ToolCalls steps={[{ id: "a", name: "browser_tabs", result: { content: '{"ok": true}' } }]} labels={labels} />);
    const row = screen.getByRole("button", { name: /browser_tabs/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("true")).toBeTruthy();
    await userEvent.click(row);
    expect(screen.queryByText("true")).toBeNull();
  });

  it("marks a call that never answered and cannot open it", () => {
    render(<ToolCalls steps={[{ id: "a", name: "browser_click" }]} labels={labels} />);
    expect(screen.getByText("not run")).toBeTruthy();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("groups several calls under one line, with failures counted", async () => {
    const steps: ToolStep[] = [
      { id: "a", name: "browser_tabs", result: { content: "ok" } },
      { id: "b", name: "browser_tabs", result: { content: "boom", is_error: true } },
      { id: "c", name: "browser_screenshot", result: { content: "[image attached]" } },
    ];
    render(<ToolCalls steps={steps} labels={labels} />);
    const group = screen.getByRole("button", { name: /Used 3 tools/ });
    expect(screen.getByText("· 1 failed")).toBeTruthy();
    expect(screen.getByText("browser_tabs, browser_screenshot")).toBeTruthy();
    await userEvent.click(group);
    expect(screen.queryByText("browser_tabs, browser_screenshot")).toBeNull();
    expect(screen.getByText("failed")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "browser_screenshot" }));
    expect(screen.getByText("No output")).toBeTruthy();
  });

  it("groups without a failure line when none failed", () => {
    render(
      <ToolCalls
        steps={[
          { id: "a", name: "x", result: { content: "1" } },
          { id: "b", name: "y" },
        ]}
        labels={labels}
      />,
    );
    expect(screen.queryByText(/failed/)).toBeNull();
  });
});

describe("Output", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("formats JSON of every kind, and shows anything else as it came", () => {
    const value = { s: "x", n: 1, b: false, z: null, a: [1, [], {}], o: { k: "v" }, e: {} };
    const { container, rerender } = render(
      <Output content={JSON.stringify(value) + " [image attached]"} empty="none" labels={labels} />,
    );
    expect(container.querySelector("pre")!.textContent).toBe(
      '{\n  "s": "x",\n  "n": 1,\n  "b": false,\n  "z": null,\n  "a": [\n    1,\n    [],\n    {}\n  ],\n  "o": {\n    "k": "v"\n  },\n  "e": {}\n}',
    );
    rerender(<Output content="[]" empty="none" labels={labels} />);
    expect(container.querySelector("pre")!.textContent).toBe("[]");
    rerender(<Output content="{not json" empty="none" labels={labels} />);
    expect(container.querySelector("pre")!.textContent).toBe("{not json");
    rerender(<Output content="plain text" empty="none" labels={labels} />);
    expect(container.querySelector("pre")!.textContent).toBe("plain text");
    rerender(<Output content="  [an image the model saw] [image attached] " empty="none" labels={labels} />);
    expect(container.textContent).toBe("none");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("shows a JSON array as a list: objects by field, anything else as text", () => {
    const items = [{ title: "Inbox", site: "mail.example", id: 3, tags: ["a"] }, "plain", 7, null, [1, 2]];
    const { container } = render(<Output content={JSON.stringify(items)} empty="none" labels={labels} />);
    const rows = container.querySelectorAll("ol > li");
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toBe("1.titleInboxsitemail.exampleid3tags[\"a\"]");
    expect([...rows].slice(1).map((r) => r.textContent)).toEqual(["2.plain", "3.7", "4.null", "5.[1,2]"]);
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders markdown, with only web links live, but never a page snapshot", () => {
    const md = "# Title\n\n**bold** and [site](https://example.com) and [local](file:///etc)";
    const { container, rerender } = render(<Output content={md} empty="none" labels={labels} />);
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
    const link = screen.getByRole("link", { name: "site" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(screen.queryByRole("link", { name: "local" })).toBeNull();
    expect(screen.getByText("local").tagName).toBe("SPAN");
    const snapshot = '- button "Send" [ref=e3]\n- link "Home" [ref=e4]';
    rerender(<Output content={snapshot} empty="none" labels={labels} />);
    expect(container.querySelector("pre")!.textContent).toBe(snapshot);
  });

  it("knows markdown by its marks", () => {
    for (const text of ["## h", "```\ncode\n```", "| a | b |", "[x](https://y)", "**b**", "- item", "1. item"]) {
      expect(looksLikeMarkdown(text), text).toBe(true);
    }
    for (const text of ["plain words", "a - b", "- item [ref_2]"]) expect(looksLikeMarkdown(text), text).toBe(false);
  });

  it("copies the output, says so for a moment, and stays quiet when copying fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const copier = vi.fn().mockResolvedValue(true);
    const { rerender, unmount } = render(
      <TextCopierContext.Provider value={copier}>
        <Output content='{"a":1}' empty="none" labels={labels} />
      </TextCopierContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(copier).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
    // Copied again before it reverts: one timer, restarted.
    await userEvent.click(screen.getByRole("button", { name: "Copied" }));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();

    const failing = vi.fn().mockResolvedValue(false);
    rerender(
      <TextCopierContext.Provider value={failing}>
        <Output content="plain" empty="none" labels={labels} />
      </TextCopierContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(failing).toHaveBeenCalledWith("plain");
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();

    // Unmounted while "Copied" shows: its timer goes with it.
    rerender(
      <TextCopierContext.Provider value={copier}>
        <Output content="plain" empty="none" labels={labels} />
      </TextCopierContext.Provider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    const clear = vi.spyOn(window, "clearTimeout");
    unmount();
    expect(clear).toHaveBeenCalled();
  });

  it("copies to the page's clipboard by default, and says nothing when it refuses", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const { unmount } = render(<Output content="hello" empty="none" labels={labels} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    unmount();

    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    render(<Output content="hello" empty="none" labels={labels} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
  });
});

describe("calls", () => {
  it("stay folded until opened", async () => {
    render(
      <ToolCalls
        steps={[
          { id: "toolu_1", name: "browser_tabs", result: { content: '["one"]' } },
          { id: "toolu_2", name: "browser_click", result: { content: "ok" } },
        ]}
        labels={labels}
      />,
    );
    // A group: open it to see both rows, each still folded.
    await userEvent.click(screen.getByRole("button", { name: /Used 2 tools/ }));
    expect(screen.getByRole("button", { name: /browser_tabs/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /browser_click/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("one")).toBeNull();
  });
});
