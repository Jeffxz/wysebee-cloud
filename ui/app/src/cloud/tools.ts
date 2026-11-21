import { CloudError } from "./errors";
import { cloudFetch } from "./data";
import { type Ctx, HttpError, json } from "./http";
import type { KindRoute } from "./routes";

/**
 * The person's tools (apps/cloud/user_tools.py, 2026-11-15), forwarded to Wysebee Cloud as
 * they are: each with an id — agents link to it by that, so it can be renamed — a kind
 * (`postgres`, `snowflake`, a site link's `gmail`… `website`, or a Mac's `program`), and for a
 * connection a write-only password, token or key, used only by the cloud. Given to agents by
 * kind (`/api/v1/agents/{agent_id}/tools`, by the agent's id).
 */

async function forward(path: string, method: string, ctx?: Ctx): Promise<Response> {
  const init: RequestInit = { method };
  if (ctx) init.body = JSON.stringify(ctx.body);
  try {
    const r = await cloudFetch(path, init);
    return json(r.status === 204 ? null : await r.json(), r.status);
  } catch (e) {
    if (e instanceof CloudError) throw new HttpError(e.status, e.message);
    throw e;
  }
}

const tool = (id: string) => `/api/v1/tools/${encodeURIComponent(id)}`;
const agentTools = (agent: string) => `/api/v1/agents/${encodeURIComponent(agent)}/tools`;

export const TOOL_ROUTES: KindRoute[] = [
  ["GET", "/api/v1/tools", () => forward("/api/v1/tools", "GET")],
  ["POST", "/api/v1/tools", (ctx) => forward("/api/v1/tools", "POST", ctx)],
  ["POST", "/api/v1/tools/test", (ctx) => forward("/api/v1/tools/test", "POST", ctx)],
  ["POST", "/api/v1/tools/validate-sql", (ctx) => forward("/api/v1/tools/validate-sql", "POST", ctx)],
  ["GET", "/api/v1/tools/{id}", (ctx) => forward(tool(ctx.params.id), "GET")],
  ["GET", "/api/v1/tools/{id}/used-by", (ctx) => forward(`${tool(ctx.params.id)}/used-by`, "GET")],
  ["PUT", "/api/v1/tools/{id}", (ctx) => forward(tool(ctx.params.id), "PUT", ctx)],
  ["DELETE", "/api/v1/tools/{id}", (ctx) => forward(tool(ctx.params.id), "DELETE")],
  ["GET", "/api/v1/agents/{agent}/tools", ({ params }) => forward(agentTools(params.agent), "GET")],
  ["PUT", "/api/v1/agents/{agent}/tools", (ctx) => forward(agentTools(ctx.params.agent), "PUT", ctx)],
];
