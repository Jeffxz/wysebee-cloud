import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockFetch, reply } from "../../../test/fetch";

/** A fake oidc-client-ts: a UserManager whose answers each test sets. */
const oidc = vi.hoisted(() => {
  const state = {
    instances: [] as FakeManager[],
    getUser: [] as unknown[],
    silent: [] as unknown[],
    callback: null as unknown,
    endSession: null as string | null,
  };
  const next = (list: unknown[]) => {
    const v = list.shift();
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(v ?? null);
  };
  class FakeManager {
    settings: Record<string, unknown>;
    signinRedirect = vi.fn(async (_args?: unknown) => {});
    signinRedirectCallback = vi.fn(async () => state.callback);
    signinSilent = vi.fn(() => next(state.silent));
    getUser = vi.fn(() => next(state.getUser));
    removeUser = vi.fn(async () => {});
    signoutRedirect = vi.fn(async (_args?: unknown) => {});
    metadataService = { getEndSessionEndpoint: vi.fn(async () => state.endSession) };
    constructor(settings: Record<string, unknown>) {
      this.settings = settings;
      state.instances.push(this);
    }
  }
  class FakeStore {
    constructor(readonly options: unknown) {}
  }
  return { state, FakeManager, FakeStore };
});

vi.mock("oidc-client-ts", () => ({ UserManager: oidc.FakeManager, WebStorageStateStore: oidc.FakeStore }));

type Auth = typeof import("./auth");

async function fresh(): Promise<Auth> {
  vi.resetModules();
  return import("./auth");
}

const config = (auth: Record<string, unknown>) => ({ "GET /api/v1/web/config": { auth } });
const full = { issuer: "https://tenant.auth0.com/", client_id: "cid", audience: "https://api" };
const last = () => oidc.state.instances[oidc.state.instances.length - 1];

beforeEach(() => {
  oidc.state.instances = [];
  oidc.state.getUser = [];
  oidc.state.silent = [];
  oidc.state.callback = null;
  oidc.state.endSession = null;
  window.history.replaceState(null, "", "/");
});

describe("before signing in", () => {
  it("has no token, profile or session", async () => {
    const auth = await fresh();
    await expect(auth.accessToken()).rejects.toThrow("Not signed in");
    await expect(auth.reauthenticate()).resolves.toBeUndefined();
    await expect(auth.currentProfile()).resolves.toBeNull();
    await expect(auth.signOut()).resolves.toBeUndefined();
  });
});

describe("signIn", () => {
  it("fails when the cloud cannot say where to sign in", async () => {
    const auth = await fresh();
    mockFetch({ "GET /api/v1/web/config": reply(500, {}) });
    await expect(auth.signIn()).rejects.toThrow("Wysebee Cloud answered 500");
    mockFetch(config({ issuer: null, client_id: "cid" }));
    await expect(auth.signIn()).rejects.toThrow("not set up");
    mockFetch(config({ issuer: "https://x/", client_id: null }));
    await expect(auth.signIn()).rejects.toThrow("not set up");
  });

  it("finishes a redirect back with the code, restoring the hash", async () => {
    const auth = await fresh();
    mockFetch(config(full));
    window.history.replaceState(null, "", "/?code=c&state=s");
    oidc.state.callback = { state: { hash: "#/tasks" }, access_token: "t" };
    const user = await auth.signIn();
    expect(user).toEqual({ state: { hash: "#/tasks" }, access_token: "t" });
    expect(window.location.hash).toBe("#/tasks");
    expect(window.location.search).toBe("");
    const m = last();
    expect(m.settings).toMatchObject({
      authority: full.issuer,
      client_id: "cid",
      response_type: "code",
      extraQueryParams: { audience: "https://api" },
      automaticSilentRenew: true,
    });
    expect((m.settings.userStore as InstanceType<typeof oidc.FakeStore>).options).toEqual({ store: window.localStorage });
  });

  it("finishes a redirect without a stored hash, and asks for no audience when none is set", async () => {
    const auth = await fresh();
    mockFetch(config({ issuer: full.issuer, client_id: "cid" }));
    window.history.replaceState(null, "", "/?code=c&state=s");
    oidc.state.callback = { state: undefined };
    await auth.signIn();
    expect(last().settings.extraQueryParams).toEqual({});
    expect(window.location.href).toBe(window.location.origin + "/");
  });

  it("keeps the analytics the cloud announces, none before", async () => {
    const auth = await fresh();
    expect(auth.analyticsOn()).toBe(false);
    mockFetch({ "GET /api/v1/web/config": { auth: full, analytics: { enabled: true } } });
    window.history.replaceState(null, "", "/?code=c&state=s");
    oidc.state.callback = { state: undefined };
    await auth.signIn();
    expect(auth.analyticsOn()).toBe(true);
    mockFetch({ "GET /api/v1/web/config": { auth: full, analytics: {} } });
    window.history.replaceState(null, "", "/?code=c&state=s");
    await auth.signIn();
    expect(auth.analyticsOn()).toBe(false);
  });

  it("sends every sign-in to the connection the cloud names", async () => {
    const auth = await fresh();
    mockFetch(config({ ...full, connection: "email" }));
    window.history.replaceState(null, "", "/?code=c&state=s");
    oidc.state.callback = { state: undefined };
    await auth.signIn();
    expect(last().settings.extraQueryParams).toEqual({ audience: "https://api", connection: "email" });
  });

  it("uses a stored session, renewing an expired one", async () => {
    const auth = await fresh();
    mockFetch(config(full));
    window.history.replaceState(null, "", "/?code=only");
    oidc.state.getUser = [{ expired: false, access_token: "a" }];
    await expect(auth.signIn()).resolves.toEqual({ expired: false, access_token: "a" });

    oidc.state.getUser = [{ expired: true }];
    oidc.state.silent = [{ expired: false, access_token: "b" }];
    await expect(auth.signIn()).resolves.toEqual({ expired: false, access_token: "b" });
  });

  it("leaves for the sign-in page when there is no session, or renewing fails", async () => {
    const auth = await fresh();
    mockFetch(config(full));
    window.location.hash = "#/tasks";
    oidc.state.getUser = [null];
    let settled = false;
    void auth.signIn().then(() => (settled = true));
    await vi.waitFor(() => expect(last()?.signinRedirect).toHaveBeenCalledWith({ state: { hash: "#/tasks" } }));

    oidc.state.getUser = [{ expired: true }];
    oidc.state.silent = [new Error("login_required")];
    void auth.signIn().then(() => (settled = true));
    await vi.waitFor(() => expect(oidc.state.instances).toHaveLength(2));
    await vi.waitFor(() => expect(last().signinRedirect).toHaveBeenCalled());
    expect(settled).toBe(false);
  });
});

async function signedIn(): Promise<{ auth: Auth; m: InstanceType<typeof oidc.FakeManager> }> {
  const auth = await fresh();
  mockFetch(config(full));
  oidc.state.getUser = [{ expired: false }];
  await auth.signIn();
  return { auth, m: last() };
}

describe("once signed in", () => {
  it("hands out a token, renewing it near expiry", async () => {
    const { auth, m } = await signedIn();
    oidc.state.getUser = [{ expires_in: 300, access_token: "fresh" }];
    await expect(auth.accessToken()).resolves.toBe("fresh");
    expect(m.signinSilent).not.toHaveBeenCalled();

    oidc.state.getUser = [{ expires_in: 10, access_token: "old" }];
    oidc.state.silent = [{ access_token: "renewed" }];
    await expect(auth.accessToken()).resolves.toBe("renewed");

    oidc.state.getUser = [{ access_token: "no-expiry" }];
    oidc.state.silent = [{ access_token: "renewed2" }];
    await expect(auth.accessToken()).resolves.toBe("renewed2");

    oidc.state.getUser = [null];
    oidc.state.silent = [null];
    await expect(auth.accessToken()).rejects.toThrow("Not signed in");
  });

  it("re-authenticates silently, else signs in again", async () => {
    const { auth, m } = await signedIn();
    oidc.state.silent = [{ access_token: "x" }];
    await auth.reauthenticate();
    expect(m.removeUser).not.toHaveBeenCalled();

    window.location.hash = "#/a";
    oidc.state.silent = [new Error("nope")];
    await auth.reauthenticate();
    expect(m.removeUser).toHaveBeenCalled();
    expect(m.signinRedirect).toHaveBeenCalledWith({ state: { hash: "#/a" } });
  });

  it("reads the profile", async () => {
    const { auth } = await signedIn();
    oidc.state.getUser = [{ profile: { sub: "s1", name: "Ann", email: "a@x.io" } }];
    await expect(auth.currentProfile()).resolves.toEqual({ sub: "s1", name: "Ann", email: "a@x.io" });
    oidc.state.getUser = [{ profile: { sub: "s4", name: "Ann@X.io", email: "ann@x.io", nickname: "ann" } }];
    await expect(auth.currentProfile()).resolves.toEqual({ sub: "s4", name: "ann", email: "ann@x.io" });
    oidc.state.getUser = [{ profile: { sub: "s2", nickname: "nick" } }];
    await expect(auth.currentProfile()).resolves.toEqual({ sub: "s2", name: "nick", email: "" });
    oidc.state.getUser = [{ profile: { sub: "s3" } }];
    await expect(auth.currentProfile()).resolves.toEqual({ sub: "s3", name: "", email: "" });
    oidc.state.getUser = [null];
    await expect(auth.currentProfile()).resolves.toBeNull();
  });

  it("signs out through the OIDC end-session endpoint when discovery has one", async () => {
    const { auth, m } = await signedIn();
    oidc.state.endSession = "https://tenant/oidc/logout";
    oidc.state.getUser = [{ id_token: "idt" }];
    await auth.signOut();
    expect(m.removeUser).toHaveBeenCalled();
    expect(m.signoutRedirect).toHaveBeenCalledWith({ id_token_hint: "idt" });

    oidc.state.getUser = [null];
    await auth.signOut();
    expect(m.signoutRedirect).toHaveBeenLastCalledWith({ id_token_hint: undefined });
  });

  it("signs out through Auth0's /v2/logout otherwise", async () => {
    const { auth, m } = await signedIn();
    const set = vi.spyOn(URLSearchParams.prototype, "set");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await auth.signOut();
    expect(m.signoutRedirect).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith("client_id", "cid");
    expect(set).toHaveBeenCalledWith("returnTo", window.location.origin + "/");

    // An authority without its trailing slash, and no logout address of its own.
    m.settings = { ...m.settings, authority: "https://tenant.auth0.com", post_logout_redirect_uri: undefined };
    const href = vi.spyOn(URL.prototype, "toString");
    await auth.signOut();
    expect(href.mock.results.some((r) => r.value === "https://tenant.auth0.com/v2/logout?client_id=cid&returnTo=" + encodeURIComponent(window.location.origin + "/"))).toBe(true);
    err.mockRestore();
  });
});

describe("billing", () => {
  it("is on only where the server says an extension serves it", async () => {
    let auth = await fresh();
    mockFetch({ "GET /api/v1/web/config": { auth: { mode: "none", issuer: null, client_id: null } }, "GET /api/v1/me": { sub: "o", name: "O", email: "" } });
    await auth.signIn();
    expect(auth.billingEnabled()).toBe(false);
    auth = await fresh();
    mockFetch({ "GET /api/v1/web/config": { auth: { mode: "none", issuer: null, client_id: null }, features: { billing: true } }, "GET /api/v1/me": { sub: "o", name: "O", email: "" } });
    await auth.signIn();
    expect(auth.billingEnabled()).toBe(true);
  });
});

describe("a self-hosted server", () => {
  const me = { sub: "local|owner", name: "Owner", email: "" };
  const header = (fn: ReturnType<typeof mockFetch>, i: number) => (fn.fn.mock.calls[i][1] as RequestInit).headers as Record<string, string>;

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("without a token: the owner, with no sign-in provider and nobody to sign out", async () => {
    const auth = await fresh();
    expect(auth.selfHosted()).toBe(false);
    const fn = mockFetch({ ...config({ mode: "none", issuer: null, client_id: null }), "GET /api/v1/me": me });
    await expect(auth.signIn()).resolves.toBeNull();
    expect(oidc.state.instances).toHaveLength(0);
    expect(auth.selfHosted()).toBe(true);
    expect(auth.canSignOut()).toBe(false);
    expect(header(fn, 1).Authorization).toBe("Bearer none");
    await expect(auth.currentProfile()).resolves.toEqual(me);
    await expect(auth.accessToken()).resolves.toBe("none");
    await auth.reauthenticate();
    await auth.signOut();
    await expect(auth.currentProfile()).resolves.toEqual(me);
  });

  it("names an owner the server leaves blank by empty strings", async () => {
    const auth = await fresh();
    mockFetch({ ...config({ mode: "none", issuer: null, client_id: null }), "GET /api/v1/me": { sub: "x" } });
    await auth.signIn();
    await expect(auth.currentProfile()).resolves.toEqual({ sub: "x", name: "", email: "" });
  });

  it("says when the server will not answer", async () => {
    const auth = await fresh();
    mockFetch({ ...config({ mode: "none", issuer: null, client_id: null }), "GET /api/v1/me": reply(500) });
    await expect(auth.signIn()).rejects.toThrow("Wysebee Cloud answered 500");
  });

  it("with a token: asks for it until it is taken, keeps it, and forgets it on sign-out", async () => {
    const auth = await fresh();
    let tries = 0;
    const fn = mockFetch({
      ...config({ mode: "token", issuer: null, client_id: null }),
      "GET /api/v1/me": () => (++tries < 3 ? reply(401) : me),
    });
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("wrong").mockReturnValueOnce(" right ");
    await auth.signIn();
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompt.mock.calls[1][0]).toContain("was refused");
    expect(header(fn, 3).Authorization).toBe("Bearer right");
    expect(window.localStorage.getItem(auth.TOKEN_KEY)).toBe("right");
    await expect(auth.accessToken()).resolves.toBe("right");
    expect(auth.canSignOut()).toBe(true);

    // Refused later: asked again.
    tries = 1;
    prompt.mockReturnValueOnce("newer");
    await auth.reauthenticate();
    expect(window.localStorage.getItem(auth.TOKEN_KEY)).toBe("newer");

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await auth.signOut();
    expect(window.localStorage.getItem(auth.TOKEN_KEY)).toBeNull();
    err.mockRestore();
    prompt.mockRestore();
  });

  it("with a token: gives up when none is typed", async () => {
    const auth = await fresh();
    mockFetch({ ...config({ mode: "token", issuer: null, client_id: null }), "GET /api/v1/me": reply(401) });
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("  ").mockReturnValueOnce(null);
    await expect(auth.signIn()).rejects.toThrow("needs its access token");
    await expect(auth.signIn()).rejects.toThrow("needs its access token");
    prompt.mockRestore();
  });

  it("still works when this browser keeps nothing", async () => {
    const auth = await fresh();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    let tries = 0;
    mockFetch({ ...config({ mode: "token", issuer: null, client_id: null }), "GET /api/v1/me": () => (++tries < 2 ? reply(401) : me) });
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("t");
    await auth.signIn();
    await expect(auth.accessToken()).resolves.toBe("none");
    get.mockRestore();
    set.mockRestore();
    prompt.mockRestore();
  });
});
