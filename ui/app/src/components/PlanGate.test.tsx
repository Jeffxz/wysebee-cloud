import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { mockFetch, reply } from "../../../test/fetch";
import { useFetchTransport } from "../../../test/transport";
import { announceSubscriptionRequired } from "../cloud/paywall";
import { RETRY_MS } from "./ProfileView/BillingTab";

const server = vi.hoisted(() => ({ billing: true }));
vi.mock("../cloud/auth", async (orig) => ({
  ...(await orig<typeof import("../cloud/auth")>()),
  billingEnabled: () => server.billing,
  canSignOut: () => true,
}));

import { cloudHost } from "../cloud/host";
import { BILLING_HASH, PlanGate } from "./PlanGate";

useFetchTransport();

const PLAN = "GET /api/v1/account/plan";
const GB = 1024 ** 3;
const usage = { devices: 0, online: 0, relay_bytes: 0, month: "2026-11", resets_at: "2026-12-01T00:00:00+00:00" };
const unpaid = { plan: null, paid: false, required: true, allowed: false, billing_url: "/app/#/account/billing", limits: null, usage };
const paid = { ...unpaid, plan: "small", paid: true, allowed: true, limits: { devices: 3, online: 2, relay_bytes: 5 * GB, storage: 5 * GB } };
const billing = {
  plans: [{ id: "small", name: "Small", amount: 500, currency: "usd", buy_url: "https://pay.example/small", devices: 3, online: 2, relay_bytes: 5 * GB, storage: 5 * GB }],
  current: null,
  manage_url: null,
  subscription: null,
  purchases: [],
};
const routes = (plan: () => unknown) => ({ [PLAN]: plan, "GET /api/v1/account/billing": billing, "GET /api/v1/account/storage": { used: 0, limit: 5 * GB, files: 0 } });
const app = <div data-testid="app">the app</div>;

beforeEach(() => {
  server.billing = true;
  window.location.hash = "#/agents";
});
afterEach(() => vi.useRealTimers());

describe("PlanGate", () => {
  it("shows Billing alone to someone without a plan, at Billing's address", async () => {
    const calls = mockFetch(routes(() => unpaid));
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByText("Choose a plan to start using Wysebee Cloud")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Subscribe" })).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
    expect(window.location.hash).toBe(BILLING_HASH);
    // Nothing but the plan and Billing's own reads.
    expect(new Set(calls.calls.map((c) => c.path))).toEqual(new Set(["/api/v1/account/plan", "/api/v1/account/billing"]));
  });

  it("opens the app for someone with a plan", async () => {
    mockFetch(routes(() => paid));
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(window.location.hash).toBe("#/agents");
  });

  it("opens the app when the plan cannot be read: the cloud refuses what it must", async () => {
    mockFetch({});
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByTestId("app")).toBeTruthy();
  });

  it("sends the person to Billing when the cloud refuses for want of a plan", async () => {
    let plan: unknown = paid;
    mockFetch(routes(() => plan));
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByTestId("app")).toBeTruthy();
    plan = unpaid;
    act(() => announceSubscriptionRequired());
    expect(await screen.findByText("Choose a plan to start using Wysebee Cloud")).toBeTruthy();
    expect(screen.queryByTestId("app")).toBeNull();
    expect(window.location.hash).toBe(BILLING_HASH);
  });

  it("opens the app without a reload once the person comes back from paying", async () => {
    let plan: unknown = unpaid;
    mockFetch(routes(() => plan));
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByText("Choose a plan to start using Wysebee Cloud")).toBeTruthy();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => void window.dispatchEvent(new Event("focus")));
    // The payment provider's word arrives just after the person is back.
    plan = paid;
    await act(async () => void vi.advanceTimersByTime(RETRY_MS));
    expect(await screen.findByTestId("app")).toBeTruthy();
    expect(window.location.hash).toBe(BILLING_HASH);
  });

  it("keeps the paywall when the plan cannot be read again, and reads nothing on return while open", async () => {
    let plan: unknown = unpaid;
    const calls = mockFetch(routes(() => plan));
    render(<PlanGate>{app}</PlanGate>);
    expect(await screen.findByText("Choose a plan to start using Wysebee Cloud")).toBeTruthy();
    // A later read that fails leaves the gate closed (Billing reads the plan too: count from here).
    const plans = () => calls.calls.filter((c) => c.path === "/api/v1/account/plan").length;
    await waitFor(() => expect(plans()).toBeGreaterThan(0));
    const read = plans();
    plan = reply(503, { detail: "down" });
    act(() => announceSubscriptionRequired());
    await waitFor(() => expect(plans()).toBe(read + 1));
    expect(screen.getByText("Choose a plan to start using Wysebee Cloud")).toBeTruthy();
    // Open, coming back to the page asks nothing.
    plan = paid;
    act(() => announceSubscriptionRequired());
    expect(await screen.findByTestId("app")).toBeTruthy();
    const before = calls.calls.length;
    act(() => void window.dispatchEvent(new Event("focus")));
    expect(calls.calls.length).toBe(before);
  });

  it("signs out from the paywall", async () => {
    const signOut = vi.spyOn(cloudHost, "signOut").mockResolvedValue();
    mockFetch(routes(() => unpaid));
    render(<PlanGate>{app}</PlanGate>);
    (await screen.findByRole("button", { name: "Sign out" })).click();
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("never gates, nor asks for the plan, on a server without plans", async () => {
    server.billing = false;
    const calls = mockFetch(routes(() => unpaid));
    render(<PlanGate>{app}</PlanGate>);
    expect(screen.getByTestId("app")).toBeTruthy();
    act(() => announceSubscriptionRequired());
    expect(screen.getByTestId("app")).toBeTruthy();
    expect(calls.calls).toEqual([]);
  });
});
