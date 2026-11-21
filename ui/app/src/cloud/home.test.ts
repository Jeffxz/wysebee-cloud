import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accessToken: vi.fn(async () => "tok"),
  reauthenticate: vi.fn(async () => {}),
  currentProfile: vi.fn(async (): Promise<{ sub: string; name: string; email: string } | null> => null),
  signOut: vi.fn(async () => {}),
}));
vi.mock("./auth", () => auth);

import { dispatch } from "./router";
import { deleteAsset, uploadAsset } from "./data";

type Row = Record<string, unknown>;

/** An agent as Wysebee Cloud keeps it (apps/cloud/agents.py). */
type Agent = { id: string; name: string; config: Row; description: string | null; created_at: string; updated_at: string };
/** What only Wysebee Cloud sets on an agent: kept as stored whatever a save sends. */
const PINNED = ["browser_link", "mac_link", "mac_folders"];

/**
 * A fake Wysebee Cloud: the agents (`/api/v1/agents`, Wysebee's
 * own made when they are listed), the person's data tables (`/api/v1/data/{table}`) and assets
 * — in memory.
 */
function fakeCloud() {
  const agents = new Map<string, Agent>();
  let made = 0;
  const agent = (name: string, config: Row = {}, id = name === "wysebee" ? "w" : `id-${name}`) => {
    const a = { id, name, config, description: null, created_at: "", updated_at: "2026-10-24T10:00:00Z" };
    agents.set(id, a);
    return a;
  };
  const tables: Record<string, Map<string, Row>> = { task_runs: new Map(), reminders: new Map() };
  const state = { assets: {} as Record<string, string>, assetTypes: [] as string[], unauthorizedOnce: false, rev: 10, desktopCalls: [] as string[], desktops: [{ install_id: "mac1", name: "Mac", status: "running", disconnected_at: null, last_seen: "2026-10-28T10:00:00Z" }] as Row[], profile: { display_name: "", avatar: "" } as Row, profileDown: false };
  const ok = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    if (state.unauthorizedOnce) {
      state.unauthorizedOnce = false;
      return ok({ detail: "sign in" }, 401);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const u = new URL(url, "http://x");
    if (u.pathname === "/api/v1/agents") {
      if (method === "POST") {
        const label = body.config?.label;
        if (!/^[a-z][a-z0-9_-]{0,29}$/.test(body.name)) return ok({ detail: "An agent's name must start with a lowercase letter." }, 422);
        if (typeof label !== "string" || !label || label.includes("\n")) return ok({ detail: "An agent's label must be one line of 1 to 60 characters." }, 422);
        if (body.name === "wysebee" || [...agents.values()].some((a) => a.name === body.name)) return ok({ detail: `There is already an agent named '${body.name}'.` }, 409);
        if ([...agents.values()].filter((a) => a.name !== "wysebee").length >= 20) return ok({ detail: "You have 20 agents already: delete one to add another." }, 409);
        return ok(agent(body.name, body.config, `new-${++made}`), 201);
      }
      if (![...agents.values()].some((a) => a.name === "wysebee")) agent("wysebee", { label: "Wysebee", browser_access: false });
      return ok({ agents: [...agents.values()].sort((a, b) => (a.name === "wysebee" ? -1 : b.name === "wysebee" ? 1 : a.name.localeCompare(b.name))) });
    }
    if (u.pathname.startsWith("/api/v1/agents/")) {
      const id = decodeURIComponent(u.pathname.split("/").pop() as string);
      const a = agents.get(id);
      if (!a) return ok({ detail: "There is no such agent." }, 404);
      if (method === "DELETE") {
        if (a.name === "wysebee") return ok({ detail: "Wysebee's own agent cannot be deleted." }, 400);
        agents.delete(id);
        return ok(null, 204);
      }
      if (method === "PUT") {
        if (body.name !== undefined && body.name !== a.name) {
          if (a.name === "wysebee") return ok({ detail: "Wysebee's own agent cannot be renamed." }, 400);
          if ([...agents.values()].some((o) => o.name === body.name)) return ok({ detail: `There is already an agent named '${body.name}'.` }, 409);
          a.name = body.name;
        }
        const config: Row = { ...body.config };
        for (const f of PINNED) {
          delete config[f];
          if (a.config[f] !== undefined) config[f] = a.config[f];
        }
        a.config = config;
      }
      return ok(a);
    }
    if (u.pathname.startsWith("/api/v1/desktops")) {
      state.desktopCalls.push(`${method} ${u.pathname}`);
      if (method === "DELETE") return u.pathname.endsWith("/gone") ? ok({ detail: "There is no such desktop." }, 404) : ok(null, 204);
      if (method === "POST") return ok({ install_id: "mac1", disconnected_at: u.pathname.endsWith("/disconnect") ? "2026-10-25T10:00:00Z" : null });
      return ok({ desktops: state.desktops });
    }
    if (u.pathname === "/api/v1/profile") {
      if (state.profileDown) return ok({ detail: "down" }, 503);
      if (method === "PUT") state.profile = { ...state.profile, ...body };
      return ok(state.profile);
    }
    if (u.pathname === "/api/v1/assets" && method === "PUT") {
      const bytes = new Uint8Array(init!.body as Uint8Array);
      const id = "a".repeat(63) + String(Object.keys(state.assets).length);
      state.assets[id] = new TextDecoder().decode(bytes);
      state.assetTypes.push(new Headers(init!.headers).get("Content-Type") ?? "");
      return ok({ id, content_type: "image/png", size: bytes.length });
    }
    if (u.pathname.startsWith("/api/v1/assets/") && method === "DELETE") {
      delete state.assets[u.pathname.split("/").pop() as string];
      return ok(null, 204);
    }
    if (u.pathname.startsWith("/api/v1/assets/")) {
      const id = u.pathname.split("/").pop() as string;
      return id in state.assets ? new Response(new TextEncoder().encode(state.assets[id]), { headers: { "Content-Type": "image/png" } }) : ok({ detail: "no" }, 404);
    }
    const [, , , , table, key] = u.pathname.split("/");
    const t = tables[table];
    if (!key) {
      let rows = [...t.values()];
      if (u.searchParams.get("task_id")) rows = rows.filter((r) => r.task_id === u.searchParams.get("task_id"));
      if (u.searchParams.get("pending")) rows = rows.filter((r) => !r.delivered_at);
      return ok({ rows });
    }
    const k = decodeURIComponent(key);
    if (method === "GET") return t.has(k) ? ok(t.get(k)) : ok({ detail: "no" }, 404);
    if (method === "PUT") {
      t.set(k, body);
      return ok(body);
    }
    if (!t.has(k)) return ok({ detail: "no" }, 404);
    t.delete(k);
    return ok(null, 204);
  });
  vi.stubGlobal("fetch", fn);
  return { agents, agent, tables, state, fn };
}

async function call(method: string, path: string, body?: unknown) {
  const r = await dispatch(method, path, body === undefined ? undefined : JSON.stringify(body));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

beforeEach(() => {
  auth.currentProfile.mockResolvedValue(null);
});

describe("Wysebee's settings on the web", () => {
  it("are Wysebee Cloud's, by id: Wysebee's own made when they are listed", async () => {
    const cloud = fakeCloud();
    const rows = (await call("GET", "/agent/agents")).body.rows;
    expect(rows).toEqual([{ id: "w", agent_name: "wysebee", updated_at: "2026-10-24T10:00:00Z", label: "Wysebee", avatar: null, browser: false, mac: false, device: null, location: "cloud" }]);
    const got = await call("GET", "/agent/agents/w");
    expect(got.body).toMatchObject({ id: "w", agent_name: "wysebee", config: { label: "Wysebee", browser_access: false }, location: "cloud" });
    expect((await call("GET", "/agent/agents/other")).status).toBe(404);
    const saved = await call("PUT", "/agent/agents/w", { config: { label: "Bee", instructions: "Be brief.", browser: "mac-chrome" } });
    expect(saved.status).toBe(200);
    expect(cloud.agents.get("w")?.config).toEqual({ label: "Bee", instructions: "Be brief." });
    // Its handle is not the person's to change.
    expect((await call("PUT", "/agent/agents/w", { config: {}, name: "bee" })).status).toBe(400);
  });

  it("say which device each paired agent works on, a phone's too", async () => {
    const cloud = fakeCloud();
    cloud.agent("pixel", { label: "Pixel", android_link: "p1", paired_kind: "wysebee-android" });
    cloud.agent("studio", { label: "Studio", mac_link: "m1", paired_kind: "wysebee-osx" });
    cloud.agent("scout", { label: "Scout", browser_link: "b1", paired_kind: "wysebee-browser-chrome" });
    // Unpaired: it keeps the kind it was made for, but works on no device now.
    cloud.agent("old", { label: "Old", paired_kind: "wysebee-android" });
    const rows = (await call("GET", "/agent/agents")).body.rows as { agent_name: string; device: string | null }[];
    expect(Object.fromEntries(rows.map((r) => [r.agent_name, r.device]))).toMatchObject({ pixel: "wysebee-android", studio: "wysebee-osx", scout: "wysebee-browser-chrome", old: null });
  });

  it("keeps the stored picture, drops a profile and what are not settings; checks what is sent", async () => {
    const cloud = fakeCloud();
    cloud.state.assets.abc = "PNG";
    // The person's profile is their own row in the cloud.
    cloud.state.profile = { display_name: "Sam", avatar: "asset:abc" };
    const bee = cloud.agent("wysebee", { label: "Bee", avatar: "asset:abc", browser: "stale", profile: { display_name: "Old", avatar: "x" }, theme: "light" });
    // An answer that names nobody (from before migration 0066) has no creator.
    expect((await call("GET", "/agent/agents/w")).body).toMatchObject({ creator: "", creator_name: "", created_by: null, updated_by: null });
    const sam = { id: "u1", name: "Sam", email: "sam@x.com" };
    Object.assign(bee, { created_by: sam, updated_by: { ...sam, id: "u2" } });
    const got = await call("GET", "/agent/agents/w");
    expect(got.body).toMatchObject({ creator: "sam@x.com", creator_name: "Sam", created_by: sam, updated_by: { ...sam, id: "u2" } });
    expect(got.body.config.avatar).toMatch(/^data:.*;base64,/);
    expect(got.body.config.browser).toBeUndefined();
    expect(got.body.updated_at).toBe("2026-10-24T10:00:00Z");
    expect((await call("GET", "/api/v1/profile")).body).toEqual({ display_name: "Sam", avatar: expect.stringMatching(/^data:/) });
    expect((await call("GET", "/api/v1/config/appearance")).body).toEqual({ theme: "light" });

    const bad = async (config: unknown, name?: unknown) => (await call("PUT", "/agent/agents/w", { config, name })).body.detail;
    expect(await bad("x")).toBe("'config' must be an object.");
    expect(await bad({ instructions: 3 })).toBe("'instructions' must be a string");
    expect(await bad({ instructions: "x".repeat(50_001) })).toMatch(/too long/);
    expect(await bad({}, 3)).toBe("'name' must be a string.");
    expect((await call("PUT", "/agent/agents/other", { config: {} })).status).toBe(404);

    // The stored picture, sent back as the data URL the page was given, is kept as it is.
    const saved = await call("PUT", "/agent/agents/w", { config: { label: "Bee 2", avatar: got.body.config.avatar, news_sites: [{ address: "https://bbc.com/news", description: "World" }], instructions: null, profile: { display_name: "Hacker" }, postgres_databases: [{ name: "x", password: "p" }] } });
    expect(saved.status).toBe(200);
    const stored = cloud.agents.get("w")?.config as Row;
    expect(stored).toMatchObject({ label: "Bee 2", avatar: "asset:abc" });
    expect(stored.profile).toBeUndefined();
    expect(stored.postgres_databases).toBeUndefined();
    expect(stored.news_sites).toBeUndefined();
  });

  it("drops a picture it cannot read, and a missing profile and picture stay missing", async () => {
    const cloud = fakeCloud();
    cloud.agent("wysebee", { avatar: "asset:gone" });
    cloud.state.profile = { display_name: "", avatar: "🦊" };
    expect((await call("GET", "/agent/agents/w")).body.config.avatar).toBeUndefined();
    expect((await call("GET", "/api/v1/profile")).body).toEqual({ display_name: "", avatar: "🦊" });
    expect((await call("GET", "/api/v1/config/appearance")).body).toEqual({ theme: "dark" });
    // A profile that cannot be read is none.
    cloud.state.profileDown = true;
    expect((await call("GET", "/api/v1/profile")).body).toEqual({ display_name: "", avatar: null });
    cloud.agent("wysebee", {});
    await call("PUT", "/agent/agents/w", { config: { profile: {} } });
    expect(cloud.agents.get("w")?.config).toEqual({});
  });
});

describe("an agent's picture, changed on the web", () => {
  it("uploads an image as an asset, keeps an emoji as text, clears it, and deletes the picture it replaced unless still shown", async () => {
    const cloud = fakeCloud();
    cloud.state.assets.old = "OLD";
    cloud.agent("aide", { label: "Aide", avatar: "asset:old" });
    const stored = () => cloud.agents.get("id-aide")?.config as Row;
    const save = (avatar: unknown) => call("PUT", "/agent/agents/id-aide", { config: { label: "Aide", avatar } });

    // A new image: uploaded, named on the agent, shown back as a data URL; the old one deleted.
    const png = "data:image/png;base64," + btoa("PNG!");
    const saved = await save(png);
    expect(saved.status).toBe(200);
    expect(saved.body.config.avatar).toMatch(/^data:/);
    const id = String(stored().avatar).replace("asset:", "");
    expect(cloud.state.assets[id]).toBe("PNG!");
    expect(cloud.state.assets.old).toBeUndefined();
    expect((await call("GET", "/agent/agents")).body.rows.find((r: Row) => r.agent_name === "aide").avatar).toMatch(/^data:/);

    // Saved again with the picture it was given: nothing uploaded or deleted.
    const uploads = cloud.state.assetTypes.length;
    await save(saved.body.config.avatar);
    expect(stored().avatar).toBe(`asset:${id}`);
    expect(cloud.state.assetTypes).toHaveLength(uploads);
    expect(cloud.state.assets[id]).toBe("PNG!");

    // The same picture on the person's profile: replaced here, it is kept for the profile.
    cloud.state.profile = { display_name: "Sam", avatar: `asset:${id}` };
    expect((await save("🦊")).body.config.avatar).toBe("🦊");
    expect(stored().avatar).toBe("🦊");
    expect(cloud.state.assets[id]).toBe("PNG!");

    // …and on another agent: kept for it.
    cloud.state.profile = { display_name: "Sam", avatar: "" };
    cloud.agent("twin", { avatar: `asset:${id}` });
    cloud.agents.get("id-aide")!.config.avatar = `asset:${id}`;
    await save("🐝");
    expect(cloud.state.assets[id]).toBe("PNG!");

    // Not sent, or sent as it is: it stays. Cleared: the default.
    await call("PUT", "/agent/agents/id-aide", { config: { label: "Aide 2" } });
    expect(stored().avatar).toBe("🐝");
    expect((await save("🐝")).body.config.avatar).toBe("🐝");
    await save("");
    expect(stored().avatar).toBeUndefined();

    // Neither a picture nor an emoji, nor another asset: refused.
    expect((await save("x".repeat(17))).status).toBe(422);
    expect((await save("asset:someone-elses")).status).toBe(422);
    expect((await save(3)).status).toBe(422);
  });
});

describe("task runs and reminders", () => {
  it("lists a task's runs and reads one, steps and all", async () => {
    const cloud = fakeCloud();
    cloud.agent("aide");
    cloud.tables.task_runs.set("r1", { run_id: "r1", task_id: "t1", status: "succeeded", trigger: "", agent_id: "id-aide", started_at: "2026-10-24 09:00:00", messages: [{ role: "assistant", content: "done" }] });
    // Its agent deleted since: none.
    cloud.tables.task_runs.set("r2", { run_id: "r2", task_id: "t2", status: "failed", trigger: "schedule", agent_id: "gone", messages: "odd" });
    const listed = await call("GET", "/api/v1/tasks/t1/runs?limit=5");
    expect(listed.body.rows).toEqual([expect.objectContaining({ id: "r1", trigger: "manual", agent: "aide", started_at: "2026-10-24T09:00:00Z", messages: null })]);
    expect((await call("GET", "/api/v1/tasks/t1/runs")).body.rows).toHaveLength(1);
    expect((await call("GET", "/api/v1/tasks/t1/runs/r1")).body.messages).toEqual([{ role: "assistant", content: "done" }]);
    expect((await call("GET", "/api/v1/tasks/t2/runs/r2")).body).toMatchObject({ trigger: "schedule", messages: [], output: null, error: null, agent: null, model: null, recording: null });
    expect((await call("GET", "/api/v1/tasks/t1/runs/r2")).status).toBe(404);
    expect((await call("GET", "/api/v1/tasks/t1/runs/gone")).status).toBe(404);
  });

  it("lists the reminders still to come, soonest first, and cancels one", async () => {
    const cloud = fakeCloud();
    cloud.tables.reminders.set("b", { id: "b", text: "Later", due_at: "2026-10-25 09:00:00" });
    cloud.tables.reminders.set("a", { id: "a", text: "Soon", due_at: "2026-10-24 09:00:00" });
    cloud.tables.reminders.set("d", { id: "d", text: "Done", due_at: "2026-10-23 09:00:00", delivered_at: "2026-10-23 09:00:05" });
    expect((await call("GET", "/api/v1/reminders")).body.reminders.map((r: Row) => r.text)).toEqual(["Soon", "Later"]);
    expect((await call("DELETE", "/api/v1/reminders/a")).status).toBe(204);
    expect((await call("DELETE", "/api/v1/reminders/d")).status).toBe(404);
    expect((await call("DELETE", "/api/v1/reminders/gone")).status).toBe(404);
  });

  it("says what the cloud refused", async () => {
    const cloud = fakeCloud();
    cloud.fn.mockImplementationOnce(async () => new Response("not json", { status: 500 }));
    expect(await call("GET", "/api/v1/reminders")).toEqual({ status: 500, body: { detail: "Wysebee Cloud answered 500" } });
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    expect((await call("GET", "/api/v1/tasks/t1/runs")).body).toEqual({ detail: "down" });
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    expect((await call("DELETE", "/api/v1/reminders/x")).status).toBe(503);
    cloud.tables.reminders.set("x", { id: "x" });
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    expect((await call("DELETE", "/api/v1/reminders/x")).status).toBe(503);
  });
});

describe("the person's own agents on the web", () => {
  it("are listed with Wysebee, added, saved, renamed and deleted", async () => {
    const cloud = fakeCloud();
    cloud.state.assets.pic = "PNG";
    cloud.agent("wysebee", { label: "Bee" });
    let list = (await call("GET", "/agent/agents")).body.rows;
    expect(list.map((r: Row) => r.agent_name)).toEqual(["wysebee"]);

    const added = await call("POST", "/agent/agents", { name: " aide ", label: " Aide " });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ id: "new-1", agent_name: "aide", config: { label: "Aide", browser_access: false } });
    const refused = async (b: unknown) => {
      const r = await call("POST", "/agent/agents", b);
      return [r.status, r.body.detail];
    };
    expect(await refused({ name: "Aide", label: "x" })).toEqual([422, expect.stringMatching(/lowercase letter/)]);
    expect(await refused({ name: "helper", label: "" })).toEqual([422, expect.stringMatching(/one line/)]);
    expect(await refused({ name: "aide", label: "Again" })).toEqual([409, "There is already an agent named 'aide'."]);

    // Saved like Wysebee's, without the app's look; its picture shows in the list.
    cloud.agents.get("new-1")!.config = { label: "Aide", avatar: "asset:pic" };
    const saved = await call("PUT", "/agent/agents/new-1", { config: { label: "My Aide", theme: "light", instructions: "Kind." } });
    expect(saved.body.config).toMatchObject({ label: "My Aide", instructions: "Kind.", avatar: expect.stringMatching(/^data:/) });
    expect(cloud.agents.get("new-1")?.config.theme).toBeUndefined();
    list = (await call("GET", "/agent/agents")).body.rows;
    expect(list.map((r: Row) => [r.agent_name, r.label])).toEqual([["aide", "My Aide"], ["wysebee", "Bee"]]);
    expect(list[0].avatar).toMatch(/^data:/);

    // Renamed: the same agent, by its id.
    const renamed = await call("PUT", "/agent/agents/new-1", { config: { label: "My Aide" }, name: "helper" });
    expect(renamed.body).toMatchObject({ id: "new-1", agent_name: "helper" });
    expect((await call("PUT", "/agent/agents/new-1", { config: {}, name: "wysebee" })).status).toBe(409);

    expect((await call("DELETE", "/agent/agents/w")).status).toBe(400);
    expect((await call("DELETE", "/agent/agents/new-1")).status).toBe(204);
    expect((await call("DELETE", "/agent/agents/new-1")).status).toBe(404);
    expect((await call("GET", "/agent/agents/new-1")).status).toBe(404);
  });

  it("refuses a twenty-first agent, and lists one with no label by its name", async () => {
    const cloud = fakeCloud();
    for (let i = 0; i < 20; i++) cloud.agent(`a${i}`);
    const r = await call("POST", "/agent/agents", { name: "one-more", label: "One more" });
    expect([r.status, r.body.detail]).toEqual([409, "You have 20 agents already: delete one to add another."]);
    expect((await call("GET", "/agent/agents")).body.rows[0]).toMatchObject({ agent_name: "a0", label: null });
  });
});

describe("where an agent lives", () => {
  it("is Wysebee Cloud: a home stored or sent is dropped by a save", async () => {
    const cloud = fakeCloud();
    cloud.agent("aide", { label: "Aide", home: "pc", home_name: "Office PC" });
    expect((await call("GET", "/agent/agents/id-aide")).body.config).toEqual({ label: "Aide" });
    const saved = (await call("PUT", "/agent/agents/id-aide", { config: { label: "Aide", home: "mac", home_name: "Elsewhere" } })).body.config;
    expect(saved).toEqual({ label: "Aide" });
    expect(cloud.agents.get("id-aide")?.config).toEqual({ label: "Aide" });
  });
});

describe("the profile and the look, changed on the web", () => {
  it("uploads a picture as an asset, names it on the profile, and deletes the one it replaced", async () => {
    const cloud = fakeCloud();
    cloud.state.assets.old = "OLD";
    cloud.state.profile = { display_name: "Sam", avatar: "asset:old" };
    const png = "data:image/png;base64," + btoa("PNG!");
    const saved = await call("PUT", "/api/v1/profile", { avatar: png });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ display_name: "Sam", avatar: expect.stringMatching(/^data:/) });
    const id = String(cloud.state.profile.avatar).replace("asset:", "");
    expect(cloud.state.assets[id]).toBe("PNG!");
    expect(cloud.state.assetTypes).toEqual(["image/png"]);
    expect(cloud.state.assets.old).toBeUndefined();

    // A name, then an emoji (the picture is deleted), then none.
    expect((await call("PUT", "/api/v1/profile", { display_name: "  Sammy " })).body.display_name).toBe("Sammy");
    expect((await call("PUT", "/api/v1/profile", { avatar: "🦊" })).body.avatar).toBe("🦊");
    expect(cloud.state.assets[id]).toBeUndefined();
    expect((await call("PUT", "/api/v1/profile", { avatar: null })).body).toEqual({ display_name: "Sammy", avatar: null });
    expect(cloud.state.profile.avatar).toBe("");

    expect((await call("PUT", "/api/v1/profile", { avatar: "x".repeat(17) })).status).toBe(422);
    expect((await call("PUT", "/api/v1/profile", { display_name: 3 })).status).toBe(422);
  });

  it("saves the look on Wysebee's settings, keeping the rest", async () => {
    const cloud = fakeCloud();
    expect((await call("PUT", "/api/v1/config/appearance", { theme: "light" })).body).toEqual({ theme: "light" });
    expect(cloud.agents.get("w")?.config).toEqual({ label: "Wysebee", browser_access: false, theme: "light" });
    cloud.agent("wysebee", { label: "Bee", theme: "light" });
    await call("PUT", "/api/v1/config/appearance", { theme: "dark" });
    expect(cloud.agents.get("w")?.config).toEqual({ label: "Bee", theme: "dark" });
    expect((await call("GET", "/api/v1/config/appearance")).body).toEqual({ theme: "dark" });
    expect((await call("PUT", "/api/v1/config/appearance", { theme: "blue" })).status).toBe(422);
  });
});

describe("what an agent's settings no longer hold", () => {
  it("drops one computer's connections, programs and browser, the removed tools, site links and skills: never shown, never written back", async () => {
    const cloud = fakeCloud();
    const shop = [{ name: "shop", host: "db" }];
    const retired = { docker_access: true, docker_changes: true, container_programs: [{ name: "x" }], android_dev: true, android_device: "p", ios_dev: true, ios_device: "u", camera: true, folders: [{ path: "/a" }] };
    cloud.agent("wysebee", { label: "Bee", postgres_databases: shop, snowflake_databases: shop, local_programs: [{ name: "x" }], browser: "left-over", sqlite_database: "notes", skills: ["old"], ...retired });
    expect((await call("GET", "/agent/agents/w")).body.config).toEqual({ label: "Bee" });
    const sent = { label: "Bee 2", postgres_databases: shop, skills: ["weather"], websites: [{ address: "https://x.io/" }], ...retired };
    expect((await call("PUT", "/agent/agents/w", { config: sent })).status).toBe(200);
    expect(cloud.agents.get("w")?.config).toEqual({ label: "Bee 2" });
  });

  it("leaves which device it is paired with to Wysebee Cloud", async () => {
    const cloud = fakeCloud();
    cloud.agent("mac", { label: "Mac", mac_link: "m1", mac_folders: [{ id: "f1" }] });
    expect((await call("GET", "/agent/agents/id-mac")).body.config).toMatchObject({ mac_link: "m1", mac_folders: [{ id: "f1" }] });
    expect((await call("PUT", "/agent/agents/id-mac", { config: { label: "Mac 2", mac_link: "other", mac_folders: [] } })).body.config).toEqual({ label: "Mac 2", mac_link: "m1", mac_folders: [{ id: "f1" }] });
  });
});

describe("storing an asset", () => {
  it("refuses what is not a base64 data URL", async () => {
    await expect(uploadAsset("data:image/png,nope")).rejects.toMatchObject({ status: 422 });
  });
});

describe("deleting an asset", () => {
  it("leaves one the cloud would not delete, and says nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "no" }), { status: 500 })));
    await expect(deleteAsset("a1")).resolves.toBeUndefined();
  });
});

describe("the account and Connect AI app routes, passed to Wysebee Cloud", () => {
  it("reads the plan, storage and billing, and an agent's AI app status and switch", async () => {
    const cloud = fakeCloud();
    const seen: string[] = [];
    const answer = (u: string, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${new URL(u, "https://x").pathname}${new URL(u, "https://x").search} ${init?.body ?? ""}`.trim());
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    cloud.fn.mockImplementation(async (u: string, init?: RequestInit) => answer(u, init));
    // Signed out meanwhile: signed in again, and asked once more.
    cloud.fn.mockImplementationOnce(async () => new Response("", { status: 401 }));
    expect((await call("GET", "/api/v1/account/plan")).body).toEqual({ ok: true });
    expect(auth.reauthenticate).toHaveBeenCalled();
    await call("GET", "/api/v1/account/storage");
    await call("GET", "/api/v1/account/billing");
    await call("GET", "/api/v1/cloud-mcp-status?agent=aide");
    await call("GET", "/api/v1/cloud-mcp-status");
    await call("PUT", "/api/v1/cloud-mcp-agents/aide", { exposed: false });
    await call("PUT", "/api/v1/cloud-mcp-agents/aide");
    await call("GET", "/api/v1/notifications?limit=5");
    await call("GET", "/api/v1/notifications");
    await call("GET", "/api/v1/notifications/unread");
    await call("POST", "/api/v1/notifications/read");
    expect((await call("DELETE", "/api/v1/notifications/n1")).status).toBe(204);
    expect(seen).toEqual([
      "GET /api/v1/plan",
      "GET /api/v1/storage",
      "GET /api/v1/billing",
      "GET /api/v1/mcp/status?agent=aide",
      "GET /api/v1/mcp/status?agent=wysebee",
      'PUT /api/v1/mcp/agents/aide {"exposed":false}',
      "PUT /api/v1/mcp/agents/aide {}",
      "GET /api/v1/notifications?limit=5",
      "GET /api/v1/notifications",
      "GET /api/v1/notifications/unread",
      "POST /api/v1/notifications/read {}",
      "DELETE /api/v1/notifications/n1",
    ]);
  });

  it("refuses a body that is not an object, and gives a run's time as it was kept", async () => {
    const cloud = fakeCloud();
    expect((await call("PUT", "/agent/agents/aide", [1])).status).toBe(422);
    cloud.tables.task_runs.set("r1", { run_id: "r1", task_id: "t1", status: "done", started_at: "2026-10-24T09:00:00Z" });
    expect((await call("GET", "/api/v1/tasks/t1/runs/r1")).body.started_at).toBe("2026-10-24T09:00:00Z");
  });

  it("passes on a failure that is not a missing row", async () => {
    const cloud = fakeCloud();
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    expect((await call("GET", "/api/v1/tasks/t1/runs/r1")).status).toBe(503);
    cloud.tables.reminders.set("x", { id: "x" });
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    cloud.fn.mockImplementationOnce(async () => new Response(JSON.stringify({ detail: "down" }), { status: 503 }));
    expect((await call("DELETE", "/api/v1/reminders/x")).status).toBe(503);
  });
});
