import { accessToken, analyticsOn, currentProfile, signIn, signOut } from "./auth";
import { startTelemetry } from "../telemetry";
import { cloudFetch } from "./data";
import { startChangeFeed } from "./events";
import { usageAnalyticsOn } from "./systemSettings";
import { dispatch } from "./router";

/** What the app needs from where it runs: sign-in, and a way to answer its requests. */
interface Host {
  /** Before the first render: sign in (redirecting away if needed) and get ready. */
  start(): Promise<void>;
  /** One admin API request, answered like the gateway would answer it. */
  request(method: string, path: string, body?: string): Promise<Response>;
  /** The signed-in person, for the rail's account button. */
  account(): { name: string; email: string } | null;
  signOut(): Promise<void>;
}

/**
 * The web app's host: sign in, then answer every admin API request in the browser over
 * wysebee-cloud (router.ts), and listen to the cloud's change feed (events.ts) so a
 * change made elsewhere shows here at once.
 */
let profile: { name: string; email: string } | null = null;

export const cloudHost: Host = {
  async start() {
    await signIn();
    const p = await currentProfile();
    profile = p ? { name: p.name, email: p.email } : null;
    // Say who signed in, for their row in `users` (an access token carries neither);
    // best effort, never in the way of the page.
    if (p) void cloudFetch("/api/v1/me", { method: "PUT", body: JSON.stringify({ email: p.email, name: p.name }) }).catch(() => {});
    startChangeFeed();
    // Usage analytics, to wysebee-cloud (telemetry.ts), when this deployment sends them and the
    // person has not turned them off (Settings → System). Read without holding up the page;
    // nothing is sent before.
    if (p) void usageAnalyticsOn().then((enabled) => startTelemetry({ on: analyticsOn(), accessToken, enabled }));
  },
  request: dispatch,
  account: () => profile,
  signOut,
};
