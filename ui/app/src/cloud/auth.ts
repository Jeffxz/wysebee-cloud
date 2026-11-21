import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";

/**
 * Signing in on the web (`--mode cloud`): the same Auth0 application and stored session
 * as wysebee-cloud's landing page (its Single Page Application, tokens in localStorage),
 * so signing in there is signing in here. Authorization code + PKCE, asking for
 * wysebee-cloud's API as `audience` (else Auth0's access token is one the API cannot
 * verify), back to `/app/` — the code arrives in the query, before the hash the page
 * routes on, and the hash the person was on travels in the sign-in state and is put
 * back. Tokens renew with the refresh token (`offline_access`; Refresh Token Rotation
 * on the application), not a hidden iframe, which third-party-cookie blocking breaks.
 *
 * Where to sign in comes from wysebee-cloud at load time (`GET /api/v1/web/config`).
 *
 * **A self-hosted server** (`WYSEBEE_EDITION=selfhost`) has no sign-in provider: its
 * `auth.mode` is `"none"` — every request is its owner — or `"token"`, when it wants its
 * access token (`WYSEBEE_SELFHOST_TOKEN`) as the bearer token: asked for once and kept in
 * this browser. Who the owner is comes from `GET /api/v1/me`.
 */
type AuthMode = "oidc" | "none" | "token";

interface WebConfig {
  auth: { mode?: AuthMode; issuer: string | null; client_id: string | null; audience?: string | null; connection?: string | null };
  /** Whether this site sends usage events (telemetry.ts, to POST /api/v1/events); not said: none are. */
  analytics?: { enabled?: boolean };
  /** Feature flags from the server's extensions: `billing` — it serves the plans (`/api/v1/plan`, `/api/v1/billing`). */
  features?: { billing?: boolean };
}

interface SignInState {
  hash: string;
}

let manager: UserManager | null = null;
let analytics: WebConfig["analytics"] = undefined;
let features: WebConfig["features"] = undefined;
let mode: AuthMode = "oidc";
let owner: { sub: string; name: string; email: string } | null = null;

/** Where a self-hosted server's access token is kept in this browser. */
export const TOKEN_KEY = "wysebee.selfhost.token";

/** Whether the server serves plans and billing (an extension's `features.billing`): the pages
 * then show Account → Billing, and only it while the plan says the person may not use the rest. */
export function billingEnabled(): boolean {
  return features?.billing === true;
}

/** Whether this is a self-hosted server: no account deletion, no sign-in provider. */
export function selfHosted(): boolean {
  return mode !== "oidc";
}

/** Whether signing out means anything here: forgetting a self-hosted server's token, or an
 * OIDC session. A self-hosted server without a token has nobody to sign out. */
export function canSignOut(): boolean {
  return mode !== "none";
}

function storedToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: asked for again next time */
  }
}

/** The self-hosted server's owner, asking for its token (again) while it is refused. */
async function signInLocally(): Promise<null> {
  for (;;) {
    const token = storedToken();
    const r = await fetch("/api/v1/me", { headers: { Accept: "application/json", Authorization: `Bearer ${token || "none"}` } });
    if (r.ok) {
      const me = (await r.json()) as { sub: string; name?: string; email?: string };
      owner = { sub: me.sub, name: me.name ?? "", email: me.email ?? "" };
      return null;
    }
    if (r.status !== 401 || mode !== "token") throw new Error(`Wysebee Cloud answered ${r.status}`);
    const typed = window.prompt(
      token ? "That access token was refused. This Wysebee Cloud's access token (WYSEBEE_SELFHOST_TOKEN):" : "This Wysebee Cloud's access token (WYSEBEE_SELFHOST_TOKEN):",
    );
    if (!typed?.trim()) throw new Error("This Wysebee Cloud needs its access token.");
    storeToken(typed.trim());
  }
}

/** Whether this deployment sends usage events, as it announced once signed in. */
export function analyticsOn(): boolean {
  return analytics?.enabled === true;
}

async function loadConfig(): Promise<WebConfig> {
  const r = await fetch("/api/v1/web/config", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Wysebee Cloud answered ${r.status}`);
  return (await r.json()) as WebConfig;
}

function appUrl(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

/** Signed in when this resolves — otherwise the browser is on its way to sign in and
 * it never does. A self-hosted server resolves null: there is no OIDC user. */
export async function signIn(): Promise<User | null> {
  const config = await loadConfig();
  analytics = config.analytics;
  features = config.features;
  mode = config.auth.mode ?? "oidc";
  if (selfHosted()) return signInLocally();
  const { issuer, client_id, audience, connection } = config.auth;
  if (!issuer || !client_id) throw new Error("Sign-in is not set up on this Wysebee Cloud.");
  manager = new UserManager({
    authority: issuer,
    client_id,
    redirect_uri: appUrl(),
    post_logout_redirect_uri: window.location.origin + "/",
    response_type: "code",
    scope: "openid profile email offline_access",
    // `connection` (WYSEBEE_AUTH_CONNECTION, e.g. "email") sends every sign-in to that one.
    extraQueryParams: { ...(audience ? { audience } : {}), ...(connection ? { connection } : {}) },
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });

  const params = new URLSearchParams(window.location.search);
  if (params.has("code") && params.has("state")) {
    const user = await manager.signinRedirectCallback();
    const hash = (user.state as SignInState | undefined)?.hash ?? "";
    window.history.replaceState(null, "", appUrl() + hash);
    return user;
  }

  let user = await manager.getUser();
  if (user?.expired) {
    try {
      user = await manager.signinSilent();
    } catch {
      user = null;
    }
  }
  if (user) return user;
  const state: SignInState = { hash: window.location.hash };
  await manager.signinRedirect({ state });
  return new Promise<User>(() => {
    /* leaving for the sign-in page */
  });
}

/** A current access token, renewed when it is about to expire. */
export async function accessToken(): Promise<string> {
  // A self-hosted server: its token, or a placeholder it does not check.
  if (selfHosted()) return storedToken() || "none";
  if (!manager) throw new Error("Not signed in");
  let user = await manager.getUser();
  if (!user || (user.expires_in ?? 0) < 30) {
    user = await manager.signinSilent();
  }
  if (!user) throw new Error("Not signed in");
  return user.access_token;
}

/** The token was refused: try once more with a fresh one, else go and sign in again. */
export async function reauthenticate(): Promise<void> {
  if (mode === "token") {
    storeToken(null);
    await signInLocally();
    return;
  }
  if (!manager) return;
  try {
    await manager.signinSilent();
  } catch {
    const state: SignInState = { hash: window.location.hash };
    await manager.removeUser();
    await manager.signinRedirect({ state });
  }
}

export async function currentProfile(): Promise<{ sub: string; name: string; email: string } | null> {
  if (selfHosted()) return owner;
  const user = await manager?.getUser();
  if (!user) return null;
  const p = user.profile;
  const email = (p.email as string | undefined) ?? "";
  // Auth0 names an account with no name of its own (an email-code sign-in) by its email:
  // the nickname (the part before the @) reads better.
  const name = (p.name as string | undefined) ?? "";
  return {
    sub: p.sub,
    name: (name.toLowerCase() === email.toLowerCase() ? "" : name) || (p.nickname as string | undefined) || "",
    email,
  };
}

export async function signOut(): Promise<void> {
  if (selfHosted()) {
    // Forget the token: the page asks for it again.
    if (mode === "token") {
      storeToken(null);
      window.location.reload();
    }
    return;
  }
  if (!manager) return;
  const user = await manager.getUser();
  await manager.removeUser();
  // Auth0's OIDC logout endpoint is in discovery only when the tenant turns it on
  // ("RP-Initiated Logout End Session Endpoint Discovery"); otherwise its /v2/logout.
  if (await manager.metadataService.getEndSessionEndpoint()) {
    await manager.signoutRedirect({ id_token_hint: user?.id_token });
    return;
  }
  const { authority, client_id, post_logout_redirect_uri } = manager.settings;
  const url = new URL("v2/logout", authority.endsWith("/") ? authority : authority + "/");
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("returnTo", post_logout_redirect_uri ?? window.location.origin + "/");
  window.location.assign(url.toString());
}
