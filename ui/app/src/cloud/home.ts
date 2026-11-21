import { assetDataUrl, deleteAsset, deleteRow, row, rows, uploadAsset, type Row } from "./data";
import { cloudFetch } from "./data";
import { type Ctx, HttpError, json } from "./http";
import { parseObject, str } from "./values";
import type { KindRoute } from "./routes";
import type { Person } from "../api";

/**
 * The admin API's routes for Wysebee and Home, in the browser, over what Wysebee Cloud keeps:
 * the person's agents, Wysebee's own among them, are Wysebee Cloud's (`/api/v1/agents`,
 * apps/cloud/agents.py, by id since 2026-11-16 — so an agent can be renamed); task runs and
 * reminders the person's data tables (data.ts).
 *
 * - **An agent's settings**: what are not settings any more (`DROPPED_FIELDS`) are never
 *   shown, and dropped by a save; which device it is paired with is the cloud's to say, kept
 *   whatever is sent. A picture is kept as an asset, shown as a data URL.
 * - **No chat** (2026-11-14, the person's call): Home lists the agents and opens each one's
 *   settings; an agent's tools are reached from an AI app through Wysebee Assistant.
 * - **The person's own agents** (2026-10-25): listed, added, renamed and deleted here, each
 *   with its "@" handle.
 */

export const WYSEBEE = "wysebee";
/** What an agent's settings no longer hold: never shown, and dropped by a save — from when
 * agents could live on Wysebee Desktop, the tools removed on 2026-11-12, and the site links,
 * programs and skills that are tools and skills of their own now (tools.ts, skills.ts). */
export const DROPPED_FIELDS = [
  "home", "home_name", "browser", "sqlite_database", "local_programs", "postgres_databases", "snowflake_databases",
  "docker_access", "docker_changes", "container_programs", "android_dev", "android_device", "ios_dev", "ios_device", "folders", "camera",
  "gmail_accounts", "calendar_sites", "travel_sites", "news_sites", "websites", "skills",
];
const ASSET = "asset:";
const INSTRUCTIONS_MAX = 50_000;

function body(ctx: Ctx): Record<string, unknown> {
  const b = ctx.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(422, "The request body must be an object.");
  return b as Record<string, unknown>;
}

/** A picture kept as an asset, as a data URL; anything else as it is. */
async function picture(value: unknown): Promise<string | null> {
  const v = str(value);
  if (!v) return null;
  return v.startsWith(ASSET) ? await assetDataUrl(v.slice(ASSET.length)) : v;
}

/** The person's profile — their row in the cloud (`/api/v1/profile`, apps/cloud/users.py):
 * `{display_name, avatar}`, an avatar as stored (an emoji or `asset:<id>`). None when it
 * cannot be read. */
async function personProfile(): Promise<Record<string, unknown>> {
  try {
    return parseObject(await (await cloudFetch("/api/v1/profile")).json());
  } catch {
    return {};
  }
}

/** An agent as Wysebee Cloud answers it. */
interface Agent {
  id: string;
  name: string;
  config: Record<string, unknown>;
  updated_at: string;
  created_by?: Person;
  updated_by?: Person;
}

const agentPath = (id: string) => `/api/v1/agents/${encodeURIComponent(id)}`;

/** Ask Wysebee Cloud about the agents: its answer. */
async function cloud<T>(path: string, method = "GET", sent?: unknown): Promise<T> {
  const r = await cloudFetch(path, { method, ...(sent !== undefined ? { body: JSON.stringify(sent) } : {}) });
  return (r.status === 204 ? null : await r.json()) as T;
}

/** Every agent, Wysebee's own first (Wysebee Cloud makes it if it has none). */
async function allAgents(): Promise<Agent[]> {
  return (await cloud<{ agents: Agent[] }>("/api/v1/agents")).agents;
}

/** An agent's settings, what they no longer hold left out. */
function configOf(agent: Agent): Record<string, unknown> {
  const config = { ...agent.config };
  for (const f of DROPPED_FIELDS) delete config[f];
  return config;
}

/** An agent as its settings page reads it, the avatar as a data URL. */
async function detail(agent: Agent): Promise<Record<string, unknown>> {
  const config = configOf(agent);
  if (typeof config.avatar === "string" && config.avatar.startsWith(ASSET)) {
    const url = await picture(config.avatar);
    if (url) config.avatar = url;
    else delete config.avatar;
  }
  return {
    id: agent.id,
    agent_name: agent.name,
    config,
    system_prompt: "",
    creator: agent.created_by?.email ?? "",
    creator_name: agent.created_by?.name ?? "",
    created_by: agent.created_by ?? null,
    updated_by: agent.updated_by ?? null,
    updated_at: agent.updated_at || null,
    location: "cloud",
  };
}

/** The checks of the agent PUT the web needs: its instructions. */
function check(config: Record<string, unknown>) {
  const instructions = config.instructions;
  if (instructions !== undefined && instructions !== null) {
    if (typeof instructions !== "string") throw new HttpError(422, "'instructions' must be a string");
    if (instructions.length > INSTRUCTIONS_MAX) throw new HttpError(422, `'instructions' is too long (max ${INSTRUCTIONS_MAX} characters).`);
  }
}

/** Save an agent's settings — and, with `name`, rename it. */
async function saveAgent(id: string, sent: Record<string, unknown>, name: unknown): Promise<Record<string, unknown>> {
  const stored = await cloud<Agent>(agentPath(id));
  const config: Record<string, unknown> = { ...sent };
  for (const f of [...DROPPED_FIELDS, "creator", "creator_name", "description"]) delete config[f];
  // The app's look is Wysebee's alone; the person's profile is their own row now, not an
  // agent's setting, so a copy sent is dropped.
  if (stored.name !== WYSEBEE) delete config.theme;
  delete config.profile;
  // The picture: an image as an asset.
  const avatar = await avatarToStore(sent.avatar, stored.config.avatar);
  if (avatar) config.avatar = avatar;
  else delete config.avatar;
  check(config);
  if (name !== undefined && typeof name !== "string") throw new HttpError(422, "'name' must be a string.");
  const saved = await cloud<Agent>(agentPath(id), "PUT", { config, ...(name !== undefined ? { name } : {}) });
  // The picture this one replaced, deleted once nothing names it: an asset is named by its
  // bytes, so another agent or the person's profile may show the same one.
  const old = str(stored.config.avatar).startsWith(ASSET) ? str(stored.config.avatar) : "";
  if (old && old !== avatar) {
    const named = (await allAgents()).some((a) => a.config.avatar === old) || str((await personProfile()).avatar) === old;
    if (!named) await deleteAsset(old.slice(ASSET.length));
  }
  return detail(saved);
}

/**
 * An agent's picture as it is stored, from what the page sent: a
 * new image (a data URL) uploaded as an asset and named `asset:<id>`; the stored picture,
 * sent back as the data URL the page was given, kept as it is; an emoji (16 characters at
 * most) as text; "" or null, none. Not sent, the stored one stays. An asset the agent does
 * not already have is never taken from the page.
 */
async function avatarToStore(sent: unknown, stored: unknown): Promise<string> {
  const before = str(stored);
  if (sent === undefined) return before;
  if (sent === null || sent === "") return "";
  if (typeof sent !== "string") throw new HttpError(422, "'avatar' is a picture (PNG, JPEG, WebP or GIF) or an emoji.");
  if (sent === before) return before;
  if (sent.startsWith("data:")) {
    if (before.startsWith(ASSET) && sent === (await picture(before))) return before;
    return ASSET + (await uploadAsset(sent));
  }
  if (!sent.startsWith(ASSET) && sent.trim() && Array.from(sent.trim()).length <= 16) return sent.trim();
  throw new HttpError(422, "'avatar' is a picture (PNG, JPEG, WebP or GIF) or an emoji.");
}

/** `PUT /api/v1/profile`: change what is sent — a name ("" clears
 * it), a picture (a data URL, uploaded as an asset first), an emoji, or null to remove it — and
 * delete the picture it replaced. Answers the profile as the page reads it. */
async function saveProfile(sent: Record<string, unknown>): Promise<Record<string, unknown>> {
  const before = await personProfile();
  const changes: Record<string, unknown> = {};
  if (sent.display_name !== undefined) {
    if (typeof sent.display_name !== "string") throw new HttpError(422, "'display_name' must be a string.");
    changes.display_name = sent.display_name.trim();
  }
  if (sent.avatar !== undefined) {
    const a = sent.avatar;
    if (a === null || a === "") changes.avatar = "";
    else if (typeof a === "string" && a.startsWith("data:")) changes.avatar = ASSET + (await uploadAsset(a));
    else if (typeof a === "string" && a.trim() && Array.from(a).length <= 16) changes.avatar = a.trim();
    else throw new HttpError(422, "'avatar' is a picture (PNG, JPEG, WebP or GIF) or an emoji.");
  }
  const next = parseObject(await (await cloudFetch("/api/v1/profile", { method: "PUT", body: JSON.stringify(changes) })).json());
  const asset = (p: Record<string, unknown>) => (str(p.avatar).startsWith(ASSET) ? str(p.avatar).slice(ASSET.length) : null);
  const old = asset(before);
  if (old && old !== asset(next)) await deleteAsset(old);
  return { display_name: str(next.display_name), avatar: await picture(next.avatar) };
}

/** Wysebee's own agent. */
async function wysebeeAgent(): Promise<Agent> {
  const agents = await allAgents();
  return agents.find((a) => a.name === WYSEBEE) as Agent;
}

/** `PUT /api/v1/config/appearance`: the look, kept on Wysebee's settings so it follows the
 * person. */
async function saveTheme(theme: unknown): Promise<{ theme: string }> {
  if (theme !== "dark" && theme !== "light") throw new HttpError(422, "'theme' is 'dark' or 'light'.");
  const wysebee = await wysebeeAgent();
  await cloud<Agent>(agentPath(wysebee.id), "PUT", { config: { ...wysebee.config, theme } });
  return { theme };
}

// The settings a paired device's link is held in (wysebee-cloud's `agent_types.LINK_FIELDS`).
const LINK_FIELDS = ["browser_link", "mac_link", "android_link"] as const;

/** Whether the agent holds a device's link now: a browser, a Mac or Windows PC, or a phone. */
function paired(config: Record<string, unknown>): boolean {
  return LINK_FIELDS.some((field) => !!str(config[field]));
}

/** Every agent, Wysebee among them (`GET /agent/agents`), each picture as a data URL. */
async function agentRows() {
  const out = await Promise.all(
    (await allAgents()).map(async (agent) => {
      const config = configOf(agent);
      return { id: agent.id, agent_name: agent.name, updated_at: agent.updated_at || null, label: str(config.label) || null, avatar: await picture(config.avatar), browser: !!str(config.browser_link), mac: !!str(config.mac_link), device: paired(config) ? str(config.paired_kind) || null : null, location: "cloud" };
    }),
  );
  return out.sort((a, b) => a.agent_name.localeCompare(b.agent_name));
}

/** One of the person's own agents: Wysebee Cloud checks its name and label. */
async function createAgent(sent: Record<string, unknown>) {
  const name = str(sent.name).trim();
  const label = str(sent.label).trim();
  return detail(await cloud<Agent>("/api/v1/agents", "POST", { name, config: { label, browser_access: false } }));
}

// --- runs and reminders --------------------------------------------------------------------

const iso = (v: unknown) => {
  const s = str(v);
  return s ? (s.includes("T") ? s : `${s.replace(" ", "T")}Z`) : null;
};

/** A task run as the page reads it: its agent by its handle now (null once deleted). */
function runOf(r: Row, withMessages: boolean, names: Map<string, string>) {
  return {
    id: str(r.run_id),
    task_id: str(r.task_id),
    status: str(r.status),
    trigger: str(r.trigger) || "manual",
    agent: names.get(str(r.agent_id)) ?? null,
    model: r.model ?? null,
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    output: r.output ?? null,
    error: r.error ?? null,
    recording: r.recording ?? null,
    messages: withMessages ? (Array.isArray(r.messages) ? r.messages : []) : null,
  };
}

/** The agents' handles, by id. */
async function agentNames(): Promise<Map<string, string>> {
  return new Map((await allAgents()).map((a) => [a.id, a.name]));
}

function reminderOf(r: Row) {
  return { id: str(r.id), text: str(r.text), due_at: iso(r.due_at), created_at: iso(r.created_at), delivered_at: iso(r.delivered_at) };
}

export const HOME_ROUTES: KindRoute[] = [
  ["GET", "/agent/agents", async () => json({ rows: await agentRows() })],
  ["POST", "/agent/agents", async (ctx) => json(await createAgent(body(ctx)), 201)],
  ["GET", "/agent/agents/{id}", async ({ params }) => json(await detail(await cloud<Agent>(agentPath(params.id))))],
  ["PUT", "/agent/agents/{id}", async (ctx) => {
    const sent = body(ctx);
    const config = sent.config;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new HttpError(422, "'config' must be an object.");
    return json(await saveAgent(ctx.params.id, config as Record<string, unknown>, sent.name));
  }],
  ["DELETE", "/agent/agents/{id}", async ({ params }) => {
    await cloud(agentPath(params.id), "DELETE");
    return json(null, 204);
  }],
  ["GET", "/api/v1/profile", async () => {
    const profile = await personProfile();
    return json({ display_name: str(profile.display_name), avatar: await picture(profile.avatar) });
  }],
  ["PUT", "/api/v1/profile", async (ctx) => json(await saveProfile(body(ctx)))],
  ["GET", "/api/v1/config/appearance", async () => json({ theme: (await wysebeeAgent()).config.theme === "light" ? "light" : "dark" })],
  ["PUT", "/api/v1/config/appearance", async (ctx) => json(await saveTheme(body(ctx).theme))],
  ["GET", "/api/v1/tasks/{id}/runs", async ({ params, query }) => {
    const limit = Number(query.get("limit") ?? 20);
    const found = await rows("task_runs", { task_id: params.id, limit: String(limit) });
    const names = await agentNames();
    return json({ rows: found.map((r) => runOf(r, false, names)) });
  }],
  ["GET", "/api/v1/tasks/{id}/runs/{run}", async ({ params }) => {
    const found = await row("task_runs", params.run);
    if (!found || found.task_id !== params.id) throw new HttpError(404, "No such run.");
    return json(runOf(found, true, await agentNames()));
  }],
  ["GET", "/api/v1/reminders", async () => {
    const pending = (await rows("reminders", { pending: "1" })).map(reminderOf);
    return json({ reminders: pending.sort((a, b) => str(a.due_at).localeCompare(str(b.due_at))) });
  }],
  ["DELETE", "/api/v1/reminders/{id}", async ({ params }) => {
    const found = await row("reminders", params.id);
    if (!found || found.delivered_at) throw new HttpError(404, "No such reminder, or it was already delivered.");
    await deleteRow("reminders", params.id);
    return json(null, 204);
  }],
];
