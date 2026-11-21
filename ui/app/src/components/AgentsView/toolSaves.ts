import { createTool, fetchAgentTools, setAgentTools, updateTool, type SiteKind, type SiteLink, type Tool, type ToolKind } from "../../api";

/**
 * Saving tools for an agent, shared by an agent's Tools tab (ToolCards.tsx) and the Tools page
 * (ToolsView.tsx, 2026-11-15): both give with the calls of apps/cloud/user_tools.py.
 */

/** A site tool's links as its dialog saves them: each the person's tool of that address (made,
 * or its description changed); their ids, in the dialog's order. The dialog has refused the
 * same address twice. */
export async function siteToolIds(library: Tool[], k: SiteKind, links: SiteLink[]): Promise<string[]> {
  const chosen: string[] = [];
  for (const link of links) {
    const address = link.address.trim();
    const description = link.description.trim();
    const found = library.find((x) => x.kind === k && x.name === address);
    const body = { name: address, description, config: { address } };
    const saved = !found ? await createTool({ kind: k, ...body }) : found.description !== description ? await updateTool(found.id, body) : found;
    chosen.push(saved.id);
  }
  return chosen;
}

/** Give an agent one more of the person's tools, after those of its kind it has; one it has
 * already stays as it is. */
export async function giveTool(agentId: string, kind: ToolKind, toolId: string): Promise<void> {
  const ids = (await fetchAgentTools(agentId)).tools.filter((x) => x.kind === kind).map((x) => x.id);
  if (ids.includes(toolId)) return;
  await setAgentTools(agentId, kind, [...ids, toolId]);
}
