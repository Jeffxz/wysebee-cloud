import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  config: { auth: { issuer: "https://t.auth0.com/", client_id: "c" }, analytics: { enabled: true } },
  manager: {} as object | null,
  user: null as { profile: { sub: string }; state?: unknown } | null,
  complete: vi.fn(),
  signIn: vi.fn(async () => {}),
  track: vi.fn(),
  trackPage: vi.fn(),
}));
vi.mock("./config", () => ({ loadConfig: async () => m.config }));
vi.mock("./analytics", () => ({ initAnalytics: vi.fn(), identify: vi.fn(), track: m.track, trackPage: m.trackPage }));
vi.mock("./auth", async (original) => ({
  ...(await original<typeof import("./auth")>()),
  initAuth: () => m.manager,
  currentUser: async () => m.user,
  completeSignIn: m.complete,
  signIn: m.signIn,
}));

import App from "./App";

const replace = vi.fn();
beforeEach(() => {
  m.manager = {};
  m.user = null;
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, pathname: "/", search: "", replace } as unknown as Location);
});
afterEach(() => replace.mockReset());

const at = (pathname: string, search = "") =>
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, pathname, search, replace } as unknown as Location);

describe("the front page", () => {
  it("sends someone not signed in straight to Auth0's sign-in, without a page of its own", async () => {
    render(<App />);
    await waitFor(() => expect(m.signIn).toHaveBeenCalledWith("sign_in", { replace: true }));
    expect(m.track).toHaveBeenCalledWith("Sign In Started", { intent: "sign_in", automatic: true });
    expect(screen.queryByText("Sign in to Wysebee Cloud")).toBeNull();
    expect(m.trackPage).not.toHaveBeenCalled();
  });

  it("opens Auth0's sign-up form for ?signup", async () => {
    at("/", "?signup");
    render(<App />);
    await waitFor(() => expect(m.signIn).toHaveBeenCalledWith("sign_up", { replace: true }));
  });

  it("sends someone signed in on to the web app", async () => {
    m.user = { profile: { sub: "s" } };
    render(<App />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/app/"));
    expect(m.signIn).not.toHaveBeenCalled();
  });

  it("stays, with its buttons, for someone back from Auth0 without signing in", async () => {
    at("/auth/callback");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    m.complete.mockRejectedValueOnce(new Error("access_denied"));
    render(<App />);
    expect(await screen.findByText("Sign in to Wysebee Cloud")).toBeTruthy();
    expect(m.signIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(m.signIn).toHaveBeenLastCalledWith("sign_in");
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
    expect(m.signIn).toHaveBeenLastCalledWith("sign_up");
  });

  it("says so when sign-in is not set up here", async () => {
    m.manager = null;
    render(<App />);
    expect(await screen.findByText(/Sign-in isn't available right now/)).toBeTruthy();
    expect(m.signIn).not.toHaveBeenCalled();
  });
});
