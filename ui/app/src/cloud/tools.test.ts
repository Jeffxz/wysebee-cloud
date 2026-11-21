import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accessToken: vi.fn(async () => "tok"),
  reauthenticate: vi.fn(async () => {}),
  currentProfile: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
}));
vi.mock("./auth", () => auth);

import { dispatch } from "./router";

/** A fake Wysebee Cloud: what each request to it was, answered as `answer` says. */
function fakeCloud(answer: (method: string, path: string) => [number, unknown] = () => [200, { ok: true }]) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const u = new URL(url, "http://x");
      const path = u.pathname + u.search;
      sent.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined });
      const [status, body] = answer(method, u.pathname);
      return new Response(status === 204 ? null : JSON.stringify(body), { status });
    }),
  );
  return { sent };
}

async function call(method: string, path: string, body?: unknown) {
  const r = await dispatch(method, path, body === undefined ? undefined : JSON.stringify(body));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}


describe("the person's tools, forwarded to Wysebee Cloud", () => {
  it("forwards each route as it is", async () => {
    const cloud = fakeCloud((method) => (method === "DELETE" ? [204, null] : method === "POST" ? [201, { id: "t1" }] : [200, { ok: true }]));
    expect(await call("GET", "/api/v1/tools")).toEqual({ status: 200, body: { ok: true } });
    expect(await call("POST", "/api/v1/tools", { kind: "website" })).toEqual({ status: 201, body: { id: "t1" } });
    await call("POST", "/api/v1/tools/test", { kind: "postgres" });
    await call("GET", "/api/v1/tools/t%201");
    await call("PUT", "/api/v1/tools/t1", { name: "x" });
    expect(await call("DELETE", "/api/v1/tools/t1")).toEqual({ status: 204, body: null });
    await call("GET", "/api/v1/agents/a1/tools");
    await call("PUT", "/api/v1/agents/a1/tools", { kind: "news", tool_ids: [] });
    expect(cloud.sent.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /api/v1/tools", "POST /api/v1/tools", "POST /api/v1/tools/test", "GET /api/v1/tools/t%201",
      "PUT /api/v1/tools/t1", "DELETE /api/v1/tools/t1", "GET /api/v1/agents/a1/tools", "PUT /api/v1/agents/a1/tools",
    ]);
    expect(cloud.sent[1].body).toEqual({ kind: "website" });
    expect(cloud.sent[5].body).toBeUndefined();
    expect(cloud.sent[7].body).toEqual({ kind: "news", tool_ids: [] });
  });

  it("says Wysebee Cloud's refusal as its own; an agent's tools are reached by its id", async () => {
    fakeCloud((_method, path) => (path.includes("/agents/a1/") ? [404, { detail: "There is no such agent." }] : path === "/api/v1/tools" ? [409, { detail: "Taken." }] : [200, { tools: [] }]));
    expect(await call("POST", "/api/v1/tools", { kind: "website" })).toEqual({ status: 409, body: { detail: "Taken." } });
    expect(await call("GET", "/api/v1/agents/a1/tools")).toEqual({ status: 404, body: { detail: "There is no such agent." } });
    expect(await call("GET", "/api/v1/agents/w/tools")).toEqual({ status: 200, body: { tools: [] } });
    expect((await call("PUT", "/api/v1/agents/w/tools", { kind: "news", tool_ids: [] })).status).toBe(200);
    // Not reached at all: the page's own 503.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect((await call("GET", "/api/v1/agents/w/tools")).status).toBe(503);
  });
});
