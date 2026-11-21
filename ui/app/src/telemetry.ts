/**
 * The website's usage analytics, sent from the page to **wysebee-cloud's `POST /api/v1/events`**
 * (`surface: "web"`), which keeps each event in Postgres and forwards it to Mixpanel
 * (apps/cloud/usage_events.py; until 2026-11-15 the page posted to Mixpanel itself).
 *
 * - **Off unless the deployment says so**: `startTelemetry` takes `analytics.enabled` from
 *   `GET /api/v1/web/config` (`WYSEBEE_EVENTS_ENABLED`). Off, `track` does nothing.
 * - **Who**: the signed-in person, by their access token on each post — the server reads the
 *   Auth0 `sub` from it; the page names nobody, and never a name or email. The page's own
 *   properties cannot set identity: `$`-prefixed keys and the names set here are dropped
 *   (and dropped again by the server).
 * - **What**: "App Started", "Page Viewed" on every route change, **"Click" for every button,
 *   link, tab, menu item, switch or checkbox pressed** (2026-10-31), and the
 *   screens' own few events. Never message text, anything typed, a key, or an agent's,
 *   topic's or task's name or id: the screens pass counts and codes only, page names are
 *   masked (`pageName`), and a click's label is its `data-track` when it has one, else its
 *   text with every name the person chose, emails, URLs and paths masked (`redact`) — and
 *   "(private)" inside a `data-track-private` container.
 * - **Only if the person allows it**: their "Send usage analytics" choice (`telemetry_enabled`
 *   in the settings that follow them, Settings → System) is read
 *   before anything is sent; off, nothing is (`setTelemetryEnabled`).
 * - **How**: queued (at most `QUEUE_MAX`), posted every `FLUSH_MS` as JSON, at most
 *   `BATCH_MAX` events a post, and once more as the page is hidden (`fetch` with `keepalive`,
 *   which, unlike a beacon, can carry the token; the token last fetched, since there is no
 *   time to fetch one then). A failure drops the batch. Never throws.
 */

export const EVENTS_URL = "/api/v1/events";
export const FLUSH_MS = 5_000;
export const QUEUE_MAX = 1000;
/** The most events the server takes in one post. */
export const BATCH_MAX = 50;
/** The largest a page's properties may be, serialised. */
export const PROPS_MAX_BYTES = 8 * 1024;
/** Names this sender or the server sets: the page cannot. */
const OWNED = new Set(["token", "distinct_id", "user_id", "time", "ip", "session_id", "app_version", "surface", "language", "page"]);

interface Event {
  event: string;
  time: number;
  insert_id: string;
  session_id: string;
  page: string;
  properties: Record<string, unknown>;
}

interface State {
  accessToken: () => Promise<string>;
  /** The token last fetched, for the post as the page goes away. */
  token: string | null;
  sessionId: string;
  appVersion: string | null;
  queue: Event[];
  timer: ReturnType<typeof setInterval> | null;
}

let state: State | null = null;
// The person's choice; nothing is sent while it is off.
let enabled = true;
const sensitive = new Set<string>();

// What a click is counted on (the desktop's list). A `label` is included because clicking
// one is how a checkbox is toggled, and the label is what names it.
const INTERACTIVE =
  "button, a[href], [role=button], [role=tab], [role=menuitem], [role=switch], " +
  "[role=option], [role=link], [role=treeitem], input[type=checkbox], " +
  "input[type=radio], select, summary";
const LABEL_MAX = 80;

/** Names the person chose — agents, tasks: masked out of every click's label. */
export function registerSensitiveNames(names: Iterable<string>): void {
  for (const n of names) if (n && n.trim().length > 1) sensitive.add(n.trim());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A label with everything that could identify the person's own content masked. */
export function redact(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  // Longest first, so "agent-a-copy" is not half-replaced by "agent-a".
  for (const name of [...sensitive].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(escapeRe(name), "g"), "<name>");
  }
  out = out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/(?:[A-Za-z]:\\|~\/|\/(?:Users|home|var|tmp|private|opt)\/)\S*/g, "<path>");
  return out.length > LABEL_MAX ? out.slice(0, LABEL_MAX - 1) + "…" : out;
}

function labelOf(el: Element): string {
  if (el.closest("[data-track-private]") && !el.hasAttribute("data-track")) return "(private)";
  const explicit = el.getAttribute("data-track");
  if (explicit) return explicit;
  const raw = el.getAttribute("aria-label") || (el instanceof HTMLInputElement && el.labels?.[0]?.textContent) || el.getAttribute("title") || el.textContent || "";
  return redact(raw) || "(unlabelled)";
}

const onClick = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  const el = target?.closest(INTERACTIVE);
  if (!el || (el as HTMLButtonElement).disabled) return;
  const props: Record<string, unknown> = { label: labelOf(el), element: el.getAttribute("role") || el.tagName.toLowerCase() };
  // A toggle's new state is not content, and without it a click on a switch says nothing
  // about which way it went.
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) props.checked = el.checked;
  else if (el.getAttribute("role") === "switch") props.checked = el.getAttribute("aria-checked") !== "true";
  track("Click", props);
};

/** The page's route, with every id and name masked: `#/agents/sam/tools` → `/agents/:name/tools`
 * (Home's old `#/home/agent/sam/tools` too, as `/home/agent/:name/tools`). */
export function pageName(hash: string): string {
  const parts = hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
  const [section = "home", sub, extra, tab] = parts;
  if (section === "home") {
    if (sub === "agent" && extra) return tab && /^[a-z-]+$/.test(tab) ? `/home/agent/:name/${tab}` : "/home/agent/:name";
    return "/home";
  }
  if (section === "agents") {
    if (!sub) return "/agents";
    return extra && /^[a-z-]+$/.test(extra) ? `/agents/:name/${extra}` : "/agents/:name";
  }
  if (section === "tasks") {
    if (!sub) return "/tasks";
    return extra && /^[a-z-]+$/.test(extra) ? `/tasks/:id/${extra}` : "/tasks/:id";
  }
  // Settings panes and the like: a fixed word, else masked.
  if (!/^[a-z-]+$/.test(section)) return "/:unknown";
  return sub ? `/${section}/${/^[a-z-]+$/.test(sub) ? sub : ":id"}` : `/${section}`;
}

function language(): string {
  try {
    return document.documentElement.lang || navigator.language || "";
  } catch {
    return "";
  }
}

/** The page's properties, as the desktop's sender keeps them: no `$` keys, nothing it
 * owns, and none at all when too large. */
function clean(props: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!k.startsWith("$") && !OWNED.has(k)) kept[k] = v;
  }
  try {
    return JSON.stringify(kept).length > PROPS_MAX_BYTES ? {} : kept;
  } catch {
    return {};
  }
}

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
}

async function freshToken(s: State): Promise<string | null> {
  try {
    s.token = await s.accessToken();
  } catch {
    /* signed out, or the sign-in could not be renewed: the last one, if any */
  }
  return s.token;
}

function post(s: State, batch: Event[], token: string, keepalive: boolean): void {
  const body = JSON.stringify({ surface: "web", app_version: s.appVersion, language: language() || null, events: batch });
  void fetch(EVENTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body,
    keepalive,
  }).catch(() => {});
}

/** Post what is queued, `BATCH_MAX` at a time: when the page is going away, at once with the
 * token last fetched; else with a fresh one. Never throws. */
export async function flush(leaving = false): Promise<void> {
  const s = state;
  if (!s || s.queue.length === 0) return;
  const queued = s.queue.splice(0, s.queue.length);
  const token = leaving ? s.token : await freshToken(s);
  if (!token) return;
  try {
    for (let i = 0; i < queued.length; i += BATCH_MAX) post(s, queued.slice(i, i + BATCH_MAX), token, leaving);
  } catch {
    /* dropped, as a batch that could not be posted is */
  }
}

const onHidden = () => {
  if (document.visibilityState === "hidden") void flush(true);
};
const onPageHide = () => void flush(true);
const onHashChange = () => track("Page Viewed");

/** Turn analytics on for the signed-in person: "App Started" now, "Page Viewed" on every
 * route change, "Click" on every press. Off for this deployment (`on` false), or `enabled`
 * false (their choice): nothing is sent. */
export function startTelemetry(config: { on: boolean | null | undefined; accessToken: () => Promise<string>; appVersion?: string | null; enabled?: boolean }): void {
  if (!config.on || state) return;
  enabled = config.enabled !== false;
  state = {
    accessToken: config.accessToken,
    token: null,
    sessionId: randomId(),
    appVersion: config.appVersion ?? null,
    queue: [],
    timer: setInterval(() => void flush(), FLUSH_MS),
  };
  void freshToken(state);
  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onHidden);
  // Capture phase, so a handler that stops propagation does not hide the click.
  document.addEventListener("click", onClick, true);
  track("App Started");
}

/** The person's "Send usage analytics" choice, as it changes: off drops what is queued and
 * sends nothing more; on sends from now. */
export function setTelemetryEnabled(on: boolean): void {
  enabled = on;
  if (!on && state) state.queue.length = 0;
}

/** One event, on the page the person is on. Does nothing while analytics are off; never throws. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  const s = state;
  if (!s || !enabled || !event || event.length > 100) return;
  if (s.queue.length >= QUEUE_MAX) return;
  s.queue.push({
    event,
    time: Date.now(),
    insert_id: randomId(),
    session_id: s.sessionId,
    page: pageName(window.location.hash),
    properties: clean(props),
  });
}

/** For tests: forget everything, sending nothing. */
export function stopTelemetry(): void {
  if (state?.timer) clearInterval(state.timer);
  state = null;
  enabled = true;
  sensitive.clear();
  document.removeEventListener("click", onClick, true);
  window.removeEventListener("hashchange", onHashChange);
  window.removeEventListener("pagehide", onPageHide);
  document.removeEventListener("visibilitychange", onHidden);
}
