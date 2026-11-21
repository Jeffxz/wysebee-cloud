import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accessToken: vi.fn(async () => "tok"),
  reauthenticate: vi.fn(async () => {}),
  currentProfile: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
}));
vi.mock("./auth", () => auth);

import { dispatch } from "./router";

const LINK = { id: "l1", agent: "sky", label: "Sky", browser: "Chrome", extension_version: "1.0.0", status: "connected", paused: false, last_seen: "2026-11-11T10:00:00Z", created_at: "2026-11-11T09:00:00Z" };

/**
 * A fake Wysebee Cloud: its agents (`/api/v1/agents`) and its browser links
 * (`/api/v1/browser-links`, apps/cloud/browser_links.py) — a claim makes the link's agent, as
 * the cloud does itself.
 */
function fakeCloud() {
  const items = new Map<string, Record<string, unknown>>();
  items.set("w", { id: "w", name: "wysebee", config: { label: "Wysebee" }, updated_at: "" });
  const state = { calls: [] as { method: string; path: string; body: unknown; auth: string | null }[], refuse: null as null | { status: number; body: unknown }, links: [] as (typeof LINK)[] };
  const ok = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const agent = (config: Record<string, unknown>) => ({ id: "a1", name: "sky", config, updated_at: "" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const path = new URL(url, "http://x").pathname;
      if (path === "/api/v1/agents") return ok({ agents: [...items.values()] });
      if (path.startsWith("/api/v1/agents/")) return ok(items.get(path.split("/").pop() as string));
      state.calls.push({ method, path, body, auth: new Headers(init?.headers).get("Authorization") });
      if (state.refuse) return state.refuse.body === undefined ? new Response("down", { status: state.refuse.status }) : ok(state.refuse.body, state.refuse.status);
      if (path === "/api/v1/browser-links") return ok({ links: state.links });
      if (path === "/api/v1/agent-types") return ok({ types: [{ id: "t1", key: "wysebee-osx", name: "Wysebee OSX Agent", description: "", enabled: true }] });
      if (path === "/api/v1/browser-links/offers") return ok({ id: "o1", token: "T".repeat(43), expires_in: 600 });
      if (path.startsWith("/api/v1/browser-links/offers/")) return ok({ state: "waiting", expires_in: 500 });
      if (path === "/api/v1/browser-links/claim") {
        state.links.push(LINK);
        items.set("a1", agent({ label: "Sky", browser_access: true, browser_link: "l1", home: "cloud", home_name: "Wysebee Cloud" }));
        return ok({ link: LINK, agent: { name: "sky", label: "Sky" } });
      }
      state.links.length = 0;
      items.set("a1", agent({ label: "Sky", browser_access: true, home: "cloud", home_name: "Wysebee Cloud" }));
      return ok(null, 204);
    }),
  );
  return { items, state };
}

async function call(method: string, path: string, body?: unknown) {
  const r = await dispatch(method, path, body === undefined ? undefined : JSON.stringify(body));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const names = async () => ((await call("GET", "/agent/agents")).body.rows as { agent_name: string }[]).map((r) => r.agent_name);


describe("the paired browsers on the web", () => {
  it("lists them, claims a code for an agent living in Wysebee Cloud, and unpairs one — with the person's token", async () => {
    const cloud = fakeCloud();
    expect(await call("GET", "/api/v1/browser-links")).toEqual({ status: 200, body: { links: [] } });
    // The agent types, for their names (2026-11-13, later).
    expect(await call("GET", "/api/v1/agent-types")).toEqual({ status: 200, body: { types: [{ id: "t1", key: "wysebee-osx", name: "Wysebee OSX Agent", description: "", enabled: true }] } });
    // The agents as read before the pairing.
    expect(await names()).toEqual(["wysebee"]);
    const claimed = await call("POST", "/api/v1/browser-links/claim", { code: " abcd-efgh " });
    expect(claimed).toEqual({ status: 200, body: { link: LINK, agent: { name: "sky", label: "Sky" } } });
    expect(cloud.state.calls[cloud.state.calls.length - 1]).toEqual({ method: "POST", path: "/api/v1/browser-links/claim", body: { code: "abcd-efgh" }, auth: "Bearer tok" });
    // The agent the cloud made shows at once, with its browser.
    expect(await names()).toEqual(["sky", "wysebee"]);
    expect((await call("GET", "/agent/agents/a1")).body.config).toMatchObject({ browser_link: "l1", browser_access: true });
    expect((await call("GET", "/api/v1/browser-links")).body.links).toEqual([LINK]);
    // Unpaired: the link is gone, and the agent is read again without it.
    expect(await call("POST", "/api/v1/browser-links/l%201/unpair")).toEqual({ status: 204, body: null });
    expect(cloud.state.calls[cloud.state.calls.length - 1]).toMatchObject({ method: "POST", path: "/api/v1/browser-links/l%201/unpair", auth: "Bearer tok" });
    expect((await call("GET", "/agent/agents/a1")).body.config.browser_link).toBeUndefined();
    expect((await call("GET", "/api/v1/browser-links")).body.links).toEqual([]);
  });

  it("asks for a code, and passes a refusal on with its code — beside the sentence, or inside it", async () => {
    const cloud = fakeCloud();
    for (const sent of [{}, { code: "  " }, { code: 7 }, null]) {
      expect(await call("POST", "/api/v1/browser-links/claim", sent)).toEqual({ status: 422, body: { detail: "Type the code the extension shows." } });
    }
    expect(cloud.state.calls).toHaveLength(0);
    // As the protocol sends it: {"detail": "<sentence>", "code": "<code>"}.
    cloud.state.refuse = { status: 404, body: { detail: "That code is wrong, used or expired.", code: "code_unknown" } };
    expect(await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH" })).toEqual({ status: 404, body: { detail: { code: "code_unknown", message: "That code is wrong, used or expired." } } });
    // …or as the cloud's other routes do: {"detail": {"code", "message"}}.
    cloud.state.refuse = { status: 409, body: { detail: { code: "name_taken", message: "There is already an agent named 'sky'." } } };
    expect(await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH" })).toEqual({ status: 409, body: { detail: { code: "name_taken", message: "There is already an agent named 'sky'." } } });
    // A taken name says whose it is, and whether it may be reconnected (2026-11-13).
    cloud.state.refuse = { status: 409, body: { detail: "taken", code: "name_taken", agent: { name: "sky", label: "Sky" }, reconnect: true } };
    expect(await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH", name: "Sky", reconnect: true })).toEqual({
      status: 409,
      body: { detail: { code: "name_taken", message: "taken", agent: { name: "sky", label: "Sky" }, reconnect: true } },
    });
    expect(cloud.state.calls[cloud.state.calls.length - 1].body).toEqual({ code: "ABCDEFGH", name: "Sky", reconnect: true });
    // Only a name given as text, and only a reconnect said as true, are passed on.
    await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH", name: 7, reconnect: "yes" });
    expect(cloud.state.calls[cloud.state.calls.length - 1].body).toEqual({ code: "ABCDEFGH" });
    cloud.state.refuse = { status: 404, body: { detail: "No such browser.", code: "browser_unpaired" } };
    expect(await call("POST", "/api/v1/browser-links/gone/unpair")).toEqual({ status: 404, body: { detail: { code: "browser_unpaired", message: "No such browser." } } });
    // A refusal with no code is the cloud's own, as it said it; so is one that is not JSON.
    cloud.state.refuse = { status: 500, body: { detail: "The cloud is busy.", code: 7 } };
    expect(await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH" })).toEqual({ status: 500, body: { detail: "The cloud is busy." } });
    cloud.state.refuse = { status: 409, body: { detail: { message: "Not now." } } };
    expect(await call("POST", "/api/v1/browser-links/l1/unpair")).toEqual({ status: 409, body: { detail: { message: "Not now." } } });
    cloud.state.refuse = { status: 502, body: undefined };
    expect((await call("GET", "/api/v1/browser-links")).status).toBe(502);
    // The cloud out of reach altogether.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await call("POST", "/api/v1/browser-links/claim", { code: "ABCDEFGH" })).toEqual({ status: 503, body: { detail: "offline" } });
    expect((await call("POST", "/api/v1/browser-links/l1/unpair")).status).toBe(503);
  });

  it("asks for a QR code's pairing and how it stands, passing a refusal on (2026-11-17)", async () => {
    const cloud = fakeCloud();
    expect(await call("POST", "/api/v1/browser-links/offers")).toEqual({ status: 200, body: { id: "o1", token: "T".repeat(43), expires_in: 600 } });
    expect(cloud.state.calls[cloud.state.calls.length - 1]).toEqual({ method: "POST", path: "/api/v1/browser-links/offers", body: {}, auth: "Bearer tok" });
    expect(await call("GET", "/api/v1/browser-links/offers/o%201")).toEqual({ status: 200, body: { state: "waiting", expires_in: 500 } });
    expect(cloud.state.calls[cloud.state.calls.length - 1].path).toBe("/api/v1/browser-links/offers/o%201");
    cloud.state.refuse = { status: 404, body: { detail: "No such offer.", code: "offer_unknown" } };
    expect(await call("GET", "/api/v1/browser-links/offers/o1")).toEqual({ status: 404, body: { detail: { code: "offer_unknown", message: "No such offer." } } });
    cloud.state.refuse = { status: 429, body: { detail: "Slow down.", code: "too_many" } };
    expect(await call("POST", "/api/v1/browser-links/offers")).toEqual({ status: 429, body: { detail: { code: "too_many", message: "Slow down." } } });
  });
});
