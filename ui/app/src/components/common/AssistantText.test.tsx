import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import { platform } from "../../platform";
import { AssistantText } from "./AssistantText";

describe("AssistantText", () => {
  it("opens http(s) links outside the app, and nothing else", async () => {
    const open = vi.spyOn(platform, "openExternal").mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const win = vi.spyOn(window, "open").mockReturnValue(null);
    render(<AssistantText text="[ext](https://x.example) [rel](/local) [none]()" />);
    await userEvent.click(screen.getByText("rel"));
    await userEvent.click(screen.getByText("none"));
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("ext"));
    expect(open).toHaveBeenCalledWith("https://x.example");
    expect(win).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("ext"));
    await waitFor(() => expect(win).toHaveBeenCalledWith("https://x.example", "_blank", "noopener"));
  });

  it("draws emails, a calendar and a chart", async () => {
    const emails = JSON.stringify([{ subject: "Invoice", body: "Pay **now**", url: "https://mail.example/1" }]);
    const calendar = JSON.stringify({ start: "2026-10-20", days: 1, url: "https://cal.example", events: [] });
    const text = [
      "```email-list\n" + emails + "\n```",
      "```email-list\nnot json\n```",
      "```calendar\n" + calendar + "\n```",
      "```calendar\nnot json\n```",
      "```d3\nroot.textContent = 'x';\n```",
    ].join("\n\n");
    render(<AssistantText text={text} />);
    // Before any await: the chart's runtime is a lazy chunk, and once another test in
    // this worker has loaded it, the placeholder is gone after the first tick.
    expect(screen.getByText("Drawing the chart…")).toBeTruthy();
    expect(screen.getByText("1 email")).toBeTruthy();
    expect(screen.getByText(/^The email list could not be read:/)).toBeTruthy();
    await userEvent.click(screen.getByText("Invoice"));
    expect(screen.getByText("now").tagName).toBe("STRONG");
    expect(screen.getByText("Open the original email").getAttribute("href")).toBe("https://mail.example/1");
    expect(screen.getByText("Nothing scheduled.")).toBeTruthy();
    expect(screen.getByText("Open the calendar")).toBeTruthy();
    expect(screen.getByText(/^The calendar could not be read:/)).toBeTruthy();
    const frame = await screen.findByTitle("Chart", undefined, { timeout: 10_000 });
    expect(frame.getAttribute("srcdoc")).toContain("root.textContent = 'x';");
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { wysebeeChart: "", error: "bad code" }, source: (frame as HTMLIFrameElement).contentWindow }),
      );
    });
    expect(screen.getByText("The chart could not be drawn: bad code")).toBeTruthy();
    // The chunk can take seconds to load under a full parallel coverage run.
  }, 20_000);

  it("names days in the language i18n resolved, else the one set, else English", () => {
    const calendar = "```calendar\n" + JSON.stringify({ start: "2026-10-20", days: 1, events: [] }) + "\n```";
    const saved = { resolved: i18n.resolvedLanguage, language: i18n.language };
    try {
      i18n.resolvedLanguage = undefined;
      const { unmount } = render(<AssistantText text={calendar} />);
      expect(screen.getByText("Tue")).toBeTruthy();
      unmount();
      (i18n as { language: string | undefined }).language = undefined;
      render(<AssistantText text={calendar} />);
      expect(screen.getByText("Tue")).toBeTruthy();
    } finally {
      i18n.resolvedLanguage = saved.resolved;
      i18n.language = saved.language;
    }
  });
});

describe("useToolLabels", () => {
  it("gives the tool-call strings in this app's words", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useToolLabels } = await import("./AssistantText");
    const { result } = renderHook(() => useToolLabels());
    const l = result.current;
    expect([l.used(2), l.failed(1), l.imageAlt("browser_screenshot")].every((s) => typeof s === "string" && s.length > 0)).toBe(true);
    expect([l.error, l.notRun, l.noOutput, l.imageEnlarge, l.imageShrink, l.copy, l.copied].every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});
