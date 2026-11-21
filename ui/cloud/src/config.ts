/**
 * What this deployment says at runtime (GET /api/v1/web/config): where to sign in and
 * whether to send usage events (to wysebee-cloud, which forwards them to Mixpanel). Read once
 * per page load, so a setting changed on the server needs no rebuild of this app.
 */
export interface WebConfig {
  /** `connection`: the Auth0 connection every sign-in goes to ("email" = the email code
   * alone); null lets Auth0's page offer them all. */
  auth: { issuer: string | null; client_id: string | null; audience: string | null; connection?: string | null };
  analytics: { enabled: boolean };
}

const EMPTY: WebConfig = {
  auth: { issuer: null, client_id: null, audience: null, connection: null },
  analytics: { enabled: false },
};

let pending: Promise<WebConfig> | null = null;

/** The config, or "nothing configured" if the server cannot be asked — the page
 * still renders, just without sign-in or tracking. */
export function loadConfig(): Promise<WebConfig> {
  pending ??= fetch("/api/v1/web/config", { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? (r.json() as Promise<WebConfig>) : EMPTY))
    .catch(() => EMPTY);
  return pending;
}
