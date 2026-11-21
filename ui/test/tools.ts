import type { Tool, ToolKind } from "../app/src/api";
import { reply, type FakeRequest } from "./fetch";

/**
 * A fake of Wysebee Cloud's tools (apps/cloud/user_tools.py) for the Tools tab's tests: the
 * person's library and one agent's tools, kept as the server keeps them — a site link named
 * by its address, a taken name a 409, the agent's tools replaced a kind at a time. Spread its
 * `routes` into `mockFetch`.
 */
export function fakeTools(agent: string, library: Tool[] = [], mine: string[] = []) {
  const state = { library: [...library], mine: [...mine], n: 0, refuse: null as null | { status: number; detail: string } };
  const at = (k: ToolKind) => state.library.filter((t) => t.kind === k).map((t) => t.id);
  const ordered = () => state.mine.map((id) => state.library.find((t) => t.id === id)!).filter(Boolean);
  const saved = (kind: ToolKind, body: Record<string, unknown>, before?: Tool): Tool => {
    const config = (body.config ?? {}) as Record<string, unknown>;
    const name = kind in SITE ? String(config.address ?? "") : String(body.name ?? "");
    const secret = body.secret === undefined ? (before?.has_secret ?? false) : body.secret !== "";
    return { id: before?.id ?? `t${++state.n}`, kind, name, description: String(body.description ?? ""), config, has_secret: secret, created_at: "", updated_at: "2026-11-15T00:00:00Z" };
  };
  const clash = (t: Tool) => state.library.some((o) => o.kind === t.kind && o.name === t.name && o.id !== t.id);
  const routes: [RegExp, (req: FakeRequest) => unknown][] = [
    [new RegExp(`^GET /api/v1/agents/${agent}/tools$`), () => ({ tools: ordered() })],
    [
      new RegExp(`^PUT /api/v1/agents/${agent}/tools$`),
      (req) => {
        if (state.refuse) return reply(state.refuse.status, { detail: state.refuse.detail });
        const { kind, tool_ids } = req.body as { kind: ToolKind; tool_ids: string[] };
        state.mine = [...state.mine.filter((id) => !at(kind).includes(id)), ...tool_ids];
        return { tools: ordered() };
      },
    ],
    [/^GET \/api\/v1\/tools(\?.*)?$/, () => ({ tools: state.library })],
    [
      /^POST \/api\/v1\/tools$/,
      (req) => {
        const b = req.body as Record<string, unknown>;
        const t = saved(b.kind as ToolKind, b);
        if (clash(t)) return reply(409, { detail: `There is already a ${t.kind} tool named '${t.name}'.` });
        state.library.push(t);
        return reply(201, t);
      },
    ],
    [
      /^PUT \/api\/v1\/tools\/[^/]+$/,
      (req) => {
        const id = req.path.split("/").pop()!;
        const before = state.library.find((t) => t.id === id);
        if (!before) return reply(404, { detail: "There is no such tool." });
        const t = saved(before.kind, req.body as Record<string, unknown>, before);
        if (clash(t)) return reply(409, { detail: `There is already a ${t.kind} tool named '${t.name}'.` });
        state.library = state.library.map((o) => (o.id === id ? t : o));
        return t;
      },
    ],
  ];
  return { state, routes };
}

const SITE = { gmail: 1, calendar: 1, travel: 1, news: 1, website: 1 };

/** A tool as Wysebee Cloud answers it. */
export function tool(kind: ToolKind, name: string, config: Record<string, unknown> = {}, over: Partial<Tool> = {}): Tool {
  return { id: `${kind}-${name}`, kind, name, description: "", config, has_secret: false, created_at: "", updated_at: "2026-11-15T00:00:00Z", ...over };
}
