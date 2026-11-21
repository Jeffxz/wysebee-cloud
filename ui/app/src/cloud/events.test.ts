import { describe, expect, it, vi } from "vitest";
import { ACTIVITY_CHANGED, APP_CHANGED, type RemoteChangeDetail } from "../api";

vi.mock("./auth", async (original) => ({ ...(await original<typeof import("./auth")>()), accessToken: vi.fn(async () => "t") }));

type Step = () => Response | Promise<Response>;

/** A fake `fetch` answering the change feed from a script; once it runs out, it hangs. */
function feed(steps: Step[]) {
  const urls: string[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(url);
    expect(init?.headers).toMatchObject({ Accept: "text/event-stream", Authorization: "Bearer t" });
    const step = steps.shift();
    if (!step) return new Promise<Response>(() => {});
    return step();
  });
  vi.stubGlobal("fetch", fn);
  return { fn, urls };
}

/** An SSE body sent in the given chunks, then closed. */
function sse(...chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function listen() {
  const seen: RemoteChangeDetail[] = [];
  const on = (e: Event) => seen.push((e as CustomEvent<RemoteChangeDetail>).detail);
  window.addEventListener(APP_CHANGED, on);
  return { seen, stop: () => window.removeEventListener(APP_CHANGED, on) };
}

async function fresh() {
  vi.resetModules();
  return import("./events");
}

describe("startChangeFeed", () => {
  it("reads events, announces each change and resumes from its cursor", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { seen, stop } = listen();
    const activity: number[] = [];
    const onActivity = (e: Event) => activity.push((e as CustomEvent<{ unread: number }>).detail.unread);
    window.addEventListener(ACTIVITY_CHANGED, onActivity);
    const { startChangeFeed } = await fresh();
    const { urls } = feed([
      // 1: a long-lived stream, closed by the cloud after more than a second.
      () => {
        vi.setSystemTime(Date.now() + 5000);
        return sse(
          "event: hello\ndata: {\"revision\": 3}\n\n",
          ": a comment\nid: 1\n\n",
          "event: hello\ndata: {\"revision\": 99}\n\n",
          "event: changes\ndata: " +
            JSON.stringify({ revision: 4, changes: [] }) +
            "\n\nevent: changes\ndata: " +
            JSON.stringify({ changes: [] }) +
            "\n\nevent: chan",
          "ges\ndata: " + JSON.stringify({ revision: 6, changes: [] }) + "\n\n",
          "event: changes\n\n",
          "event: changes\ndata: {not json\n\n",
          "event: other\ndata: {}\n\n",
          "event: activity\ndata: {\"unread\": 2}\n\n",
          "event: activity\ndata: {}\n\n",
        );
      },
      // 2: refused, 3: no body, 4: fetch fails — each backs off, doubling.
      () => new Response("no", { status: 500 }),
      () => new Response(null, { status: 200 }),
      () => Promise.reject(new Error("offline")),
      // 5: closed at once — backs off too.
      () => sse(),
    ]);

    startChangeFeed();
    startChangeFeed(); // once is enough
    await vi.waitFor(() => expect(urls).toHaveLength(2));
    expect(urls[0]).toBe("/api/v1/configs/events");
    expect(urls[1]).toBe("/api/v1/configs/events?since=6");

    // Every change is announced (the feed names nothing; the page reads its lists again).
    expect(seen).toEqual(Array.from({ length: 4 }, () => ({ remote: true, changes: [], own: false })));
    // The unread count: announced for the rail's badge; a frame with none is skipped.
    expect(activity).toEqual([2]);
    window.removeEventListener(ACTIVITY_CHANGED, onActivity);

    await vi.advanceTimersByTimeAsync(1000);
    expect(urls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(urls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(4000);
    expect(urls).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(8000);
    expect(urls).toHaveLength(6);
    stop();
  });

  it("starts from the head when the hello names none, and caps the backoff", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { seen, stop } = listen();
    const { startChangeFeed } = await fresh();
    const fail = () => new Response("no", { status: 503 });
    const { urls } = feed([
      () => sse("event: hello\n\n", "event: changes\ndata: {\"changes\": [] }\n\n"),
      ...Array.from({ length: 8 }, () => fail),
    ]);
    startChangeFeed();
    await vi.waitFor(() => expect(urls).toHaveLength(1));
    // Closed quickly: backs off 1 s, then 2, 4, … up to a minute.
    for (const ms of [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
      const before = urls.length;
      await vi.advanceTimersByTimeAsync(ms);
      expect(urls).toHaveLength(before + 1);
    }
    expect(urls[1]).toBe("/api/v1/configs/events");
    expect(seen).toEqual([{ remote: true, changes: [], own: false }]);
    stop();
  });

  it("marks a change that comes while this page is writing as most likely its own", async () => {
    const { seen, stop } = listen();
    const { startChangeFeed } = await fresh();
    const { trackWrite } = await import("./ownWrites");
    let finish!: () => void;
    const saving = trackWrite(() => new Promise<void>((r) => (finish = r)));
    feed([() => sse("event: changes\ndata: {\"revision\": 7}\n\n")]);
    startChangeFeed();
    await vi.waitFor(() => expect(seen).toEqual([{ remote: true, changes: [], own: true }]));
    finish();
    await saving;
    stop();
  });
});
