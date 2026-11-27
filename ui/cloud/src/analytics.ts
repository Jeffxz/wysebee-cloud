/**
 * Usage events for this site's front page, posted to wysebee-cloud's `POST /api/v1/events`
 * (`surface: "landing"`), which keeps each in Postgres and forwards it to Mixpanel
 * (apps/cloud/usage_events.py). Until 2026-11-15 this was Mixpanel's own library, posting to
 * Mixpanel; the page now loads nothing of Mixpanel's. Off — every call a no-op — until
 * `initAnalytics` is told this deployment sends them (`analytics.enabled` in
 * /api/v1/web/config), and while the browser asks not to be tracked (Do Not Track), as before.
 * Nor in a browser driven by a program (`navigator.webdriver`: Puppeteer, Playwright, Selenium),
 * which would otherwise log "Sign In Started" on every load; wysebee-cloud also drops events
 * from crawlers' and headless browsers' user agents.
 *
 * **Who someone is**: before sign-in, a random id this browser keeps (`anonymous_id`, in
 * localStorage), and nothing else; once signed in, their access token (`identify`), from
 * which the server reads their Auth0 user id — never a name, email or username. Mixpanel gets
 * the random id as `$device_id`, so the visit before signing in joins the person after.
 *
 * Each event is posted on its own, at once, with `keepalive`: most are sent just before the
 * page goes to Auth0 or the web app, and would otherwise be lost.
 */

export const EVENTS_URL = "/api/v1/events";
const ANONYMOUS_KEY = "wysebee.anonymous_id";

let enabled = false;
let accessToken: string | null = null;
let anonymousId = "";
let sessionId = "";

function randomId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Math.random().toString(16).slice(2).padEnd(12, "0") + Date.now().toString(16);
  }
}

/** This browser's random id, kept across visits; a new one each visit where storage is refused. */
function browserId(): string {
  try {
    const kept = localStorage.getItem(ANONYMOUS_KEY);
    if (kept) return kept;
    const made = randomId();
    localStorage.setItem(ANONYMOUS_KEY, made);
    return made;
  } catch {
    return randomId();
  }
}

export function initAnalytics(on: boolean | null | undefined): void {
  if (!on || enabled) return;
  if (typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || navigator.webdriver)) return;
  anonymousId = browserId();
  sessionId = randomId();
  enabled = true;
}

export function track(event: string, props: Record<string, string | number | boolean> = {}): void {
  if (!enabled) return;
  const body = {
    surface: "landing",
    anonymous_id: anonymousId,
    language: navigator.language || null,
    events: [
      {
        event,
        time: Date.now(),
        insert_id: randomId(),
        session_id: sessionId,
        page: window.location.pathname,
        // The super property Mixpanel's library added, so the reports there carry on.
        properties: { ...props, app: "wysebee-cloud-web" },
      },
    ],
  };
  try {
    void fetch(EVENTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* dropped: analytics never get in the page's way */
  }
}

/** A page view: the path only — no query string, which can carry codes and tokens. */
export function trackPage(): void {
  track("Page Viewed", { path: window.location.pathname });
}

/** Signed in: their events carry their access token from now on. */
export function identify(token: string): void {
  if (enabled) accessToken = token;
}

/** For tests: forget everything. */
export function resetAnalytics(): void {
  enabled = false;
  accessToken = null;
  anonymousId = "";
  sessionId = "";
}
