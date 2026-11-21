import { cloudFetch } from "./data";
import { json } from "./http";
import type { KindRoute } from "./routes";

/**
 * An agent's Connect AI app on the web: its MCP address in Wysebee Cloud
 * (apps/cloud/agent_mcp.py, Wysebee Assistant's `/assistant/mcp`) and what it offers — read from the cloud, which knows its own public address.
 */
export const AI_APP_ROUTES: KindRoute[] = [
  ["GET", "/api/v1/cloud-mcp-status", async (ctx) => {
    const agent = ctx.query.get("agent") ?? "wysebee";
    return json(await (await cloudFetch(`/api/v1/mcp/status?agent=${encodeURIComponent(agent)}`)).json());
  }],
  // One agent on or off for AI apps: off, Wysebee's MCP server neither lists it nor runs its tools.
  ["PUT", "/api/v1/cloud-mcp-agents/{agent}", async (ctx) => {
    const sent = JSON.stringify(ctx.body ?? {});
    return json(await (await cloudFetch(`/api/v1/mcp/agents/${encodeURIComponent(ctx.params.agent)}`, { method: "PUT", body: sent })).json());
  }],
];
