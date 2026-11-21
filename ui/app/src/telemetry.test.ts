import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BATCH_MAX, EVENTS_URL, FLUSH_MS, PROPS_MAX_BYTES, QUEUE_MAX, flush, pageName, redact, registerSensitiveNames, setTelemetryEnabled, startTelemetry, stopTelemetry, track } from "./telemetry";

type Posted = { event: string; time: number; insert_id: string; session_id: string; page: string; properties: Record<string, unknown> };
type Sent = { url: string; init: RequestInit; body: { surface: string; app_version: string | null; language: string | null; events: Posted[] } };

const token = () => vi.fn(async () => "tok");

describe("telemetry", () => {
  let sent: Sent[];
  let fetchMock: ReturnType<typeof vi.fn>;
  const events = () => sent.flatMap((s) => s.body.events);

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, init, body: JSON.parse(init.body as string) });
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/home/agent/sam";
  });

  afterEach(() => {
    stopTelemetry();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends nothing when this deployment sends no usage events", async () => {
    startTelemetry({ on: false, accessToken: token() });
    startTelemetry({ on: undefined, accessToken: token() });
    track("Chat Message Sent", { turn: 1 });
    await vi.advanceTimersByTimeAsync(FLUSH_MS * 2);
    await flush(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batches events to wysebee-cloud with the person's token, every few seconds", async () => {
    const accessToken = token();
    startTelemetry({ on: true, accessToken, appVersion: "1.25.0" });
    // Started once only.
    startTelemetry({ on: true, accessToken: token() });
    track("Chat Message Sent", { turn: 2, $os: "x", distinct_id: "spoof", token: "spoof", surface: "spoof", page: "spoof" });
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(EVENTS_URL);
    // Who it is comes from the token; the page names nobody.
    expect(sent[0].init).toMatchObject({ method: "POST", keepalive: false, headers: { "Content-Type": "application/json", Authorization: "Bearer tok" } });
    expect(sent[0].body).toMatchObject({ surface: "web", app_version: "1.25.0" });
    const [started, message] = sent[0].body.events;
    expect(started.event).toBe("App Started");
    expect(started.page).toBe("/home/agent/:name");
    expect(message.event).toBe("Chat Message Sent");
    expect(message.properties).toEqual({ turn: 2 });
    expect(typeof message.time).toBe("number");
    expect(typeof message.insert_id).toBe("string");
    expect(message.session_id).toBe(started.session_id);
    // Nothing queued: nothing posted.
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(sent).toHaveLength(1);
  });

  it("posts at most a batch's worth of events at a time", async () => {
    startTelemetry({ on: true, accessToken: token() });
    for (let i = 0; i < BATCH_MAX; i++) track("Many", {});
    await flush();
    expect(sent.map((s) => s.body.events.length)).toEqual([BATCH_MAX, 1]);
  });

  it("reports page views masked, drops oversized props, caps the queue, and never throws", async () => {
    startTelemetry({ on: true, accessToken: token() });
    window.location.hash = "#/tasks/abc123/run";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    track("Big", { blob: "x".repeat(PROPS_MAX_BYTES + 1) });
    track("", {});
    track("x".repeat(101), {});
    for (let i = 0; i < QUEUE_MAX + 5; i++) track("Many", {});
    fetchMock.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    await expect(flush()).resolves.toBeUndefined();
    track("After", {});
    await flush();
    expect(events().map((e) => e.event)).toEqual(["After"]);
    expect(events()[0].page).toBe("/tasks/:id/run");
  });

  it("sends nothing it has no token for", async () => {
    const accessToken = vi.fn(async (): Promise<string> => {
      throw new Error("signed out");
    });
    startTelemetry({ on: true, accessToken });
    await flush();
    track("Later", {});
    await flush(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives a page with no language, props it cannot write, and no crypto", async () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("insecure context");
    });
    startTelemetry({ on: true, accessToken: token() });
    vi.spyOn(document, "documentElement", "get").mockImplementation(() => {
      throw new Error("no document");
    });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    track("Odd", { loop });
    await flush();
    vi.restoreAllMocks();
    expect(sent[0].body.language).toBeNull();
    // A page with no language of its own, in a browser that names none.
    document.documentElement.lang = "";
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    track("Plain", {});
    await flush();
    vi.restoreAllMocks();
    expect(sent[1].body.language).toBeNull();
    const odd = events().find((e) => e.event === "Odd")!;
    expect(odd.properties.loop).toBeUndefined();
    expect(typeof odd.insert_id).toBe("string");
    expect(typeof odd.session_id).toBe("string");
  });

  it("sends at once, with the token it has, when the page goes away", async () => {
    vi.stubGlobal("navigator", { ...navigator, language: "fr" });
    startTelemetry({ on: true, accessToken: token() });
    // The first token, fetched as analytics start.
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event("pagehide"));
    expect(sent).toHaveLength(1);
    expect(sent[0].init).toMatchObject({ keepalive: true, headers: { Authorization: "Bearer tok" } });
    expect(sent[0].body.language).toBe("fr");
    expect(sent[0].body.events[0].event).toBe("App Started");
    track("Chat Cleared", { turns: 1 });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent[1].body.events[0].event).toBe("Chat Cleared");
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    // Shown again: nothing.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sent).toHaveLength(2);
  });

  it("masks every id and name in page names", () => {
    expect(pageName("")).toBe("/home");
    expect(pageName("#/home")).toBe("/home");
    expect(pageName("#/home/topic/123?settings=tools")).toBe("/home");
    expect(pageName("#/home/agent/aide")).toBe("/home/agent/:name");
    expect(pageName("#/home/agent/aide/tools")).toBe("/home/agent/:name/tools");
    expect(pageName("#/home/agent/aide/A1")).toBe("/home/agent/:name");
    expect(pageName("#/agents")).toBe("/agents");
    expect(pageName("#/agents/aide")).toBe("/agents/:name");
    expect(pageName("#/agents/aide/tools")).toBe("/agents/:name/tools");
    expect(pageName("#/agents/aide/A1")).toBe("/agents/:name");
    expect(pageName("#/tasks")).toBe("/tasks");
    expect(pageName("#/tasks/abc")).toBe("/tasks/:id");
    expect(pageName("#/tasks/abc/run")).toBe("/tasks/:id/run");
    expect(pageName("#/tasks/abc/Weird1")).toBe("/tasks/:id");
    expect(pageName("#/settings")).toBe("/settings");
    expect(pageName("#/settings/connections")).toBe("/settings/connections");
    expect(pageName("#/settings/X9")).toBe("/settings/:id");
    expect(pageName("#/Agents_9")).toBe("/:unknown");
  });
});

describe("telemetry: clicks and the person's choice", () => {
  let sent: { event: string; properties: Record<string, unknown> }[];

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_: string, init: RequestInit) => {
        sent.push(...(JSON.parse(init.body as string).events as Posted[]).map((e) => ({ event: e.event, properties: { ...e.properties, page: e.page } })));
        return new Response(null, { status: 204 });
      }),
    );
    window.location.hash = "#/settings/system";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    stopTelemetry();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  const clicks = async () => {
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    return sent.filter((e) => e.event === "Click").map((e) => e.properties);
  };
  const press = (html: string, selector: string) => {
    const box = document.createElement("div");
    box.innerHTML = html;
    document.body.appendChild(box);
    (box.querySelector(selector) as HTMLElement).click();
  };

  it("counts every press of a button, link, tab, switch or checkbox, by a label that names nothing of the person's", async () => {
    startTelemetry({ on: true, accessToken: token() });
    registerSensitiveNames(["Travel Planner", "x", ""]);
    press('<button data-track="Save agent">Save Travel Planner</button>', "button");
    press('<button aria-label="Open Travel Planner\'s settings"><span>⚙</span></button>', "span");
    press('<a href="#/x" title="Mail sam@example.com at https://wysebee.ai/a in /Users/sam/notes">x</a>', "a");
    press('<div role="tab">General</div>', "[role=tab]");
    press('<button role="switch" aria-checked="false">On</button>', "button");
    press('<label><input type="checkbox" /> Send usage analytics</label>', "input");
    press('<ul data-track-private><li><button>My secret topic</button></li></ul>', "button");
    press('<button>   </button>', "button");
    press(`<button>${"long ".repeat(30)}</button>`, "button");
    press('<input type="radio" />', "input");
    press('<button role="switch" aria-checked="true">On</button>', "button");
    // Not counted: a disabled button, text, or a click on the page itself.
    press("<button disabled>Nope</button>", "button");
    press("<p>Just text</p>", "p");
    document.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const got = await clicks();
    expect(got.map((c) => c.label)).toEqual([
      "Save agent",
      "Open <name>'s settings",
      "Mail <email> at <url> in <path>",
      "General",
      "On",
      "Send usage analytics",
      "(private)",
      "(unlabelled)",
      expect.stringMatching(/…$/),
      "(unlabelled)",
      "On",
    ]);
    expect(got[9]).toMatchObject({ element: "input", checked: true });
    expect(got[10]).toMatchObject({ element: "switch", checked: false });
    expect(got[3]).toMatchObject({ element: "tab", page: "/settings/system" });
    expect(got[4]).toMatchObject({ element: "switch", checked: true });
    expect(got[5]).toMatchObject({ element: "input", checked: true });
    expect(got[0].element).toBe("button");
    expect((got[8].label as string).length).toBe(80);
    expect(redact("agent Travel Planner here")).toBe("agent <name> here");
  });

  it("sends nothing while the person has it off, and from the moment they turn it on", async () => {
    startTelemetry({ on: true, accessToken: token(), enabled: false });
    press("<button>Hidden</button>", "button");
    track("Chat Message Sent");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(sent).toEqual([]);
    setTelemetryEnabled(true);
    press("<button>Seen</button>", "button");
    expect((await clicks()).map((c) => c.label)).toEqual(["Seen"]);
    // Turned off again: what was waiting is dropped.
    press("<button>Waiting</button>", "button");
    setTelemetryEnabled(false);
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(sent.filter((e) => e.properties.label === "Waiting")).toEqual([]);
    // Before analytics start at all, turning it off is only remembered.
    stopTelemetry();
    setTelemetryEnabled(false);
  });
});
