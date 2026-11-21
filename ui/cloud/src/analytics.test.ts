import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS_URL, identify, initAnalytics, resetAnalytics, track, trackPage } from "./analytics";

type Body = { surface: string; anonymous_id: string; language: string | null; events: { event: string; page: string; session_id: string; insert_id: string; properties: Record<string, unknown> }[] };

describe("the front page's usage events", () => {
  let sent: { url: string; init: RequestInit; body: Body }[];

  beforeEach(() => {
    sent = [];
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init, body: JSON.parse(init.body as string) });
        return new Response(null, { status: 204 });
      }),
    );
  });

  afterEach(() => {
    resetAnalytics();
    vi.unstubAllGlobals();
  });

  it("sends nothing until this deployment says so", () => {
    initAnalytics(false);
    initAnalytics(null);
    track("Sign In Clicked");
    identify("tok");
    expect(sent).toEqual([]);
  });

  it("sends nothing while the browser asks not to be tracked", () => {
    vi.stubGlobal("navigator", { doNotTrack: "1", language: "en" });
    initAnalytics(true);
    track("Sign In Clicked");
    expect(sent).toEqual([]);
  });

  it("posts each event at once to wysebee-cloud, by this browser's random id, then with the person's token", () => {
    initAnalytics(true);
    // Started once only.
    initAnalytics(true);
    trackPage();
    track("Sign In Started", { intent: "sign_in", automatic: true });
    expect(sent.map((s) => s.url)).toEqual([EVENTS_URL, EVENTS_URL]);
    expect(sent[0].init).toMatchObject({ method: "POST", keepalive: true, headers: { "Content-Type": "application/json" } });
    expect((sent[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    const [viewed, started] = sent.map((s) => s.body);
    expect(viewed).toMatchObject({ surface: "landing", anonymous_id: localStorage.getItem("wysebee.anonymous_id") });
    expect(viewed.events[0]).toMatchObject({ event: "Page Viewed", page: "/", properties: { path: "/", app: "wysebee-cloud-web" } });
    expect(started.events[0].properties).toEqual({ intent: "sign_in", automatic: true, app: "wysebee-cloud-web" });
    expect(started.events[0].session_id).toBe(viewed.events[0].session_id);
    expect(started.anonymous_id).toBe(viewed.anonymous_id);

    identify("tok");
    track("Signed In");
    expect(sent[2].init.headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(sent[2].body.anonymous_id).toBe(viewed.anonymous_id);
  });

  it("keeps the browser's id across visits", () => {
    localStorage.setItem("wysebee.anonymous_id", "kept-browser-id");
    initAnalytics(true);
    track("Sign In Clicked");
    expect(sent[0].body.anonymous_id).toBe("kept-browser-id");
  });

  it("works without storage, crypto or a language, and never throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new Error("insecure context");
    });
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    initAnalytics(true);
    track("Sign In Clicked");
    expect(sent[0].body.anonymous_id.length).toBeGreaterThanOrEqual(8);
    expect(sent[0].body.language).toBeNull();
    vi.mocked(fetch).mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => track("Sign In Clicked")).not.toThrow();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    expect(() => track("Sign In Clicked")).not.toThrow();
  });
});
