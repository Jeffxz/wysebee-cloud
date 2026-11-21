import { User, UserManager, WebStorageStateStore } from "oidc-client-ts";
import type { WebConfig } from "./config";

/**
 * Signing in to this site with Auth0: authorization code + PKCE in the browser (the
 * site's Single Page Application), back to /auth/callback, asking for wysebee-cloud's
 * API as `audience` — without it Auth0 hands out an access token the API cannot verify.
 * "Sign up" is the same flow with `screen_hint=signup`, which opens Auth0's sign-up form.
 *
 * Tokens are kept in localStorage so the sign-in survives a reload or a new tab, and the
 * access token is renewed in the background with the refresh token (`offline_access`;
 * the application needs Refresh Token Rotation on).
 */
export const CALLBACK_PATH = "/auth/callback";

/** Carried through Auth0 and back, to tell a sign-up from a sign-in. */
export interface SignInState {
  intent: "sign_in" | "sign_up";
}

let manager: UserManager | null = null;

export function initAuth(config: WebConfig): UserManager | null {
  const { issuer, client_id, audience, connection } = config.auth;
  if (!issuer || !client_id) return null;
  manager ??= new UserManager({
    authority: issuer,
    client_id,
    redirect_uri: window.location.origin + CALLBACK_PATH,
    post_logout_redirect_uri: window.location.origin + "/",
    response_type: "code",
    scope: "openid profile email offline_access",
    extraQueryParams: { ...(audience ? { audience } : {}), ...(connection ? { connection } : {}) },
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
  });
  return manager;
}

/** Off to Auth0's page. `replace`: this page is not kept in the history, so Back from
 * Auth0 does not land on a page that sends the person straight back. */
export function signIn(intent: SignInState["intent"], { replace = false }: { replace?: boolean } = {}): Promise<void> {
  if (!manager) return Promise.resolve();
  const state: SignInState = { intent };
  return manager.signinRedirect({
    state,
    ...(replace ? { redirectMethod: "replace" as const } : {}),
    ...(intent === "sign_up" ? { extraQueryParams: signUpParams() } : {}),
  });
}

/** What the address asks for: `?signup` (or `?screen_hint=signup`) is Auth0's sign-up form. */
export function intentOf(search: string): SignInState["intent"] {
  const params = new URLSearchParams(search);
  return params.has("signup") || params.get("screen_hint") === "signup" ? "sign_up" : "sign_in";
}

/** extraQueryParams replaces the manager's, so the audience and connection are repeated. */
function signUpParams(): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(manager?.settings.extraQueryParams ?? {})) {
    if (typeof value === "string") params[key] = value;
  }
  return { ...params, screen_hint: "signup" };
}

/** The signed-in user, with an access token that is still valid; null otherwise. */
export async function currentUser(): Promise<User | null> {
  if (!manager) return null;
  const user = await manager.getUser();
  if (!user) return null;
  if (!user.expired) return user;
  try {
    return await manager.signinSilent();
  } catch {
    await manager.removeUser();
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (!manager) return;
  const user = await manager.getUser();
  await manager.removeUser();
  // End the Auth0 session too, so "Sign in" asks again; back to this site after. The
  // OIDC logout endpoint is in discovery only when the tenant turns it on ("RP-Initiated
  // Logout End Session Endpoint Discovery"); otherwise Auth0's own /v2/logout.
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

/** Finish the redirect back from Auth0. Throws on an error answer (cancelled, …). */
export function completeSignIn(): Promise<User> {
  if (!manager) return Promise.reject(new Error("Sign-in is not configured"));
  return manager.signinRedirectCallback();
}
