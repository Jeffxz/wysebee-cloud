import { vi } from "vitest";

/**
 * A fake `fetch` answering the admin API from a route table — the edge `yarn dev`
 * crosses (api.ts `authedFetch` without a bridge). Each route is
 * `"METHOD /path"` (exact, query string included only when the key has one) or a
 * RegExp tested against `"METHOD /path?query"`, mapped to a body (sent as JSON with
 * 200), a `reply(...)` or a function of the request.
 *
 * Unmatched requests answer 404 `{"detail": "no route: …"}` so a missing route shows up
 * in the test's failure rather than hanging.
 */
export interface FakeRequest {
  method: string;
  path: string;
  url: string;
  body: unknown;
}

export interface Reply {
  __reply: true;
  status: number;
  body?: unknown;
  text?: string;
}

export const reply = (status: number, body?: unknown): Reply => ({ __reply: true, status, body });
export const replyText = (status: number, text: string): Reply => ({ __reply: true, status, text });

type Handler = unknown | Reply | ((req: FakeRequest) => unknown | Reply | Promise<unknown | Reply>);
export type Routes = Record<string, Handler> | [string | RegExp, Handler][];

function toResponse(value: unknown): Response {
  if (value instanceof Response) return value;
  if (value && typeof value === "object" && (value as Reply).__reply) {
    const r = value as Reply;
    const noBody = r.status === 204 || r.status === 304;
    const text = r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body));
    return new Response(noBody ? null : text, { status: r.status });
  }
  return new Response(JSON.stringify(value ?? null), { status: 200 });
}

export function mockFetch(routes: Routes = {}) {
  const table: [string | RegExp, Handler][] = Array.isArray(routes) ? [...routes] : Object.entries(routes);
  const calls: FakeRequest[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.split("?")[0];
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const req: FakeRequest = { method, path, url, body };
    calls.push(req);
    const keyFull = `${method} ${url}`;
    const keyPath = `${method} ${path}`;
    // Later routes win, so `routes.set(...)` can override.
    for (let i = table.length - 1; i >= 0; i--) {
      const [match, handler] = table[i];
      const hit =
        typeof match === "string" ? match === keyFull || (!match.includes("?") && match === keyPath) : match.test(keyFull);
      if (!hit) continue;
      const value = typeof handler === "function" ? await (handler as (r: FakeRequest) => unknown)(req) : handler;
      return toResponse(value);
    }
    return toResponse(reply(404, { detail: `no route: ${keyFull}` }));
  });
  vi.stubGlobal("fetch", fn);
  return {
    fn,
    calls,
    /** Add or replace a route (later routes win). */
    set(match: string | RegExp, handler: Handler) {
      table.push([match, handler]);
    },
    /** The requests made to `"METHOD /path"` (path without query). */
    to(key: string) {
      return calls.filter((c) => `${c.method} ${c.path}` === key || `${c.method} ${c.url}` === key);
    },
  };
}
