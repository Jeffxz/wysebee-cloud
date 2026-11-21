import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../app/src/i18n";
import { ChartView, type ChartSource } from "./ChartView";
import { CHART_MESSAGE_KEY, CHART_RUN_KEY } from "./chartRuntime";

const labels = {
  title: "Chart",
  loading: "Loading chart…",
  failed: (e: string) => `Failed: ${e}`,
  showCode: "Show code",
};

function post(source: MessageEventSource | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ChartView (desktop srcdoc)", () => {
  it("shows loading, then the frame with d3 and the code inlined", async () => {
    const d3 = deferred<string>();
    const source: ChartSource = { kind: "srcdoc", d3: () => d3.promise };
    render(<ChartView code="root.append('svg')" source={source} labels={labels} />);
    expect(screen.getByText("Loading chart…")).toBeTruthy();
    // A message before the frame exists is ignored.
    post(window, { [CHART_MESSAGE_KEY]: "", height: 300 });
    await act(async () => d3.resolve("var d3 = {};"));
    const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("var d3 = {};");
    expect(frame.getAttribute("srcdoc")).toContain("root.append('svg')");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.style.height).toBe("160px");
  });

  it("takes height and errors from its own frame only, clamped", async () => {
    const source: ChartSource = { kind: "srcdoc", d3: () => Promise.resolve("d3") };
    render(<ChartView code="x" source={source} labels={labels} />);
    const frame = (await screen.findByTitle("Chart")) as HTMLIFrameElement;
    const win = frame.contentWindow!;
    // Another window's message, a null message, an untagged one: ignored.
    post(window, { [CHART_MESSAGE_KEY]: "", height: 300 });
    post(win, null);
    post(win, { height: 300 });
    expect(frame.style.height).toBe("160px");
    // "ready" is for the extension's page; a srcdoc frame just goes on.
    post(win, { [CHART_MESSAGE_KEY]: "", ready: true });
    post(win, { [CHART_MESSAGE_KEY]: "", height: 5 });
    expect(frame.style.height).toBe("24px");
    post(win, { [CHART_MESSAGE_KEY]: "", height: 5000 });
    expect(frame.style.height).toBe("900px");
    post(win, { [CHART_MESSAGE_KEY]: "", height: 0 });
    post(win, { [CHART_MESSAGE_KEY]: "", height: "400" });
    expect(frame.style.height).toBe("900px");
    post(win, { [CHART_MESSAGE_KEY]: "", error: "d3 is broken" });
    expect(screen.getByText("Failed: d3 is broken")).toBeTruthy();
    expect(screen.getByText("Show code")).toBeTruthy();
    expect(frame.className).toContain("hidden");
  });

  it("shows why d3 could not load, Error or not", async () => {
    const { unmount } = render(
      <ChartView code="a" source={{ kind: "srcdoc", d3: () => Promise.reject(new Error("offline")) }} labels={labels} />,
    );
    expect(await screen.findByText("Failed: offline")).toBeTruthy();
    expect(screen.queryByText("Loading chart…")).toBeNull();
    expect(screen.queryByTitle("Chart")).toBeNull();
    unmount();
    render(<ChartView code="b" source={{ kind: "srcdoc", d3: () => Promise.reject("nope") }} labels={labels} />);
    expect(await screen.findByText("Failed: nope")).toBeTruthy();
  });

  it("ignores d3 arriving (or failing) after it is gone", async () => {
    const ok = deferred<string>();
    const bad = deferred<string>();
    const a = render(<ChartView code="a" source={{ kind: "srcdoc", d3: () => ok.promise }} labels={labels} />);
    const b = render(<ChartView code="b" source={{ kind: "srcdoc", d3: () => bad.promise }} labels={labels} />);
    a.unmount();
    b.unmount();
    await act(async () => {
      ok.resolve("d3");
      bad.reject(new Error("late"));
    });
    expect(screen.queryByText("Failed: late")).toBeNull();
  });
});

describe("ChartView (extension page)", () => {
  it("points at the page and hands it the code once it is ready", () => {
    render(<ChartView code="draw()" source={{ kind: "page", url: "chart.html" }} labels={labels} />);
    const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("chart.html");
    const win = frame.contentWindow!;
    const sent = vi.spyOn(win, "postMessage").mockImplementation(() => {});
    post(win, { [CHART_MESSAGE_KEY]: "", ready: true });
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ [CHART_RUN_KEY]: true, code: "draw()" }), "*");
  });

  it("does nothing when its frame has no window", () => {
    render(<ChartView code="draw()" source={{ kind: "page", url: "chart.html" }} labels={labels} />);
    const frame = screen.getByTitle("Chart") as HTMLIFrameElement;
    Object.defineProperty(frame, "contentWindow", { get: () => null });
    post(null, { [CHART_MESSAGE_KEY]: "", ready: true });
    expect(frame.style.height).toBe("160px");
  });
});
