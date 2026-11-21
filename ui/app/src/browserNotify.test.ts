import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, reply } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import { ACTIVITY_CHANGED } from "./api";
import * as m from "./browserNotify";

useFetchTransport();

const agents = vi.hoisted(() => ({ now: null as { name: string; label: string; avatar: string }[] | null }));
vi.mock("./agents", () => ({ agentsNow: () => agents.now }));

/** A stand-in for the browser's Notification: what was shown, and the permission. */
class FakeNotification {
  static permission: NotificationPermission = "default";
  static answer: NotificationPermission = "granted";
  static shown: FakeNotification[] = [];
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  });
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this);
  }
}

const note = (id: string, title: string, read: boolean, agent: string | null = null, body = "") => ({ id, title, body, agent, created_at: "", read });
const fire = (unread: number) => window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread } }));
const settle = () => new Promise((r) => setTimeout(r, 0));


beforeEach(() => {
  vi.stubGlobal("Notification", FakeNotification);
  FakeNotification.permission = "default";
  FakeNotification.answer = "granted";
  FakeNotification.shown = [];
  agents.now = [{ name: "scout", label: "Scout", avatar: "" }];
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser notifications", () => {
  it("are on once asked for and allowed, and off when turned off or refused", async () => {
    expect(m.browserNotifySupported()).toBe(true);
    expect(m.browserNotifyOn()).toBe(false);
    expect(await m.turnOnBrowserNotify()).toBe("granted");
    expect(m.browserNotifyOn()).toBe(true);
    m.turnOffBrowserNotify();
    expect(m.browserNotifyOn()).toBe(false);
    FakeNotification.answer = "denied";
    expect(await m.turnOnBrowserNotify()).toBe("denied");
    expect(m.browserNotifyOn()).toBe(false);
    // Storage blocked: off, and nothing thrown.
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    FakeNotification.permission = "granted";
    expect(m.browserNotifyOn()).toBe(false);
    m.turnOffBrowserNotify();
    get.mockRestore();
    set.mockRestore();
    vi.stubGlobal("Notification", undefined);
    delete (window as { Notification?: unknown }).Notification;
    expect(m.browserNotifySupported()).toBe(false);
  });

  it("turns Markdown into one short line", async () => {
    const { plain } = m;
    expect(plain("# Done\n\n**All** [tests](https://x) pass `now`\n```\ncode\n```")).toBe("Done All tests pass now");
    expect(plain("x".repeat(300))).toHaveLength(180);
  });

  it("shows what came while the tab was behind, named for its agent, and opens Activity", async () => {
    await m.turnOnBrowserNotify();
    const f = mockFetch({
      "GET /api/v1/notifications/unread": { unread: 1 },
      "GET /api/v1/notifications?limit=2": {
        notifications: [note("n3", "Report ready", false, "scout", "**Done.**"), note("n2", "From a gone agent", false, "gone"), note("n1", "Old", true)],
        unread: 3,
      },
      "GET /api/v1/notifications?limit=5": { notifications: [note("n9", "Plain", false)], unread: 9 },
    });
    const open = vi.fn();
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const stop = m.startBrowserNotify(open);
    await vi.waitFor(() => expect(f.to("GET /api/v1/notifications/unread")).toHaveLength(1));
    await settle();
    fire(3);
    await vi.waitFor(() => expect(FakeNotification.shown).toHaveLength(2));
    // Oldest first, so the newest ends on top.
    expect(FakeNotification.shown.map((n) => [n.title, n.options.body, n.options.tag])).toEqual([
      ["@gone", "From a gone agent", "n2"],
      ["Scout", "Report ready\nDone.", "n3"],
    ]);
    FakeNotification.shown[1].onclick?.();
    expect(focus).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
    expect(FakeNotification.shown[1].close).toHaveBeenCalled();
    // Read (fewer), or the same: nothing new to show.
    fire(0);
    fire(0);
    // Many at once: at most five asked for; from no agent, it is Wysebee's.
    fire(9);
    await vi.waitFor(() => expect(FakeNotification.shown).toHaveLength(3));
    expect(FakeNotification.shown[2].title).toBe("Wysebee");
    // In front: the badge says it.
    hasFocus.mockReturnValue(true);
    fire(10);
    // Turned off: none.
    hasFocus.mockReturnValue(false);
    m.turnOffBrowserNotify();
    fire(11);
    // A failed read shows nothing, and throws nothing.
    await m.turnOnBrowserNotify();
    f.set("GET /api/v1/notifications?limit=1", reply(503, { detail: "down" }));
    fire(12);
    await settle();
    await settle();
    expect(FakeNotification.shown).toHaveLength(3);
    stop();
    fire(20);
    await settle();
    expect(FakeNotification.shown).toHaveLength(3);
  });

  it("takes its first count from the feed when the read fails or comes late", async () => {
    await m.turnOnBrowserNotify();
    let release: (r: Response) => void = () => {};
    mockFetch({
      "GET /api/v1/notifications/unread": () => new Promise<Response>((r) => (release = r)),
      "GET /api/v1/notifications?limit=1": { notifications: [note("n1", "One", false)], unread: 3 },
    });
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const stop = m.startBrowserNotify(vi.fn());
    // The first count heard: nothing before it to compare with.
    fire(2);
    fire(3);
    await vi.waitFor(() => expect(FakeNotification.shown).toHaveLength(1));
    // The read answering late does not undo what the feed said; then stopped, it is dropped.
    release(new Response(JSON.stringify({ unread: 0 }), { status: 200 }));
    await settle();
    fire(3);
    await settle();
    expect(FakeNotification.shown).toHaveLength(1);
    stop();
    const again = m.startBrowserNotify(vi.fn());
    mockFetch({ "GET /api/v1/notifications/unread": reply(503, { detail: "down" }) });
    again();
  });
});
