import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { mockFetch, reply } from "../../../../test/fetch";
import { useFetchTransport } from "../../../../test/transport";
import { BillingTab, RETRY_MS, money, subscriptionLine } from "./BillingTab";
import { PlanUsage, percentOf } from "./PlanUsage";

useFetchTransport();

const PLAN = "GET /api/v1/account/plan";
const STORAGE = "GET /api/v1/account/storage";
const BILLING = "GET /api/v1/account/billing";
const GB = 1024 ** 3;
// Plans as a billing extension might list them: the page has none of its own.
const SMALL = "https://pay.example/small?ref=abc";
const LARGE = "https://pay.example/large?ref=abc";
const PORTAL = "https://pay.example/portal";
const plans = (subscribed = false) => [
  { id: "small", name: "Small", amount: 500, currency: "usd", buy_url: subscribed ? null : SMALL, devices: 2, online: 1, relay_bytes: GB, storage: 2 * GB },
  { id: "large", name: "Large", amount: 1500, currency: "usd", buy_url: subscribed ? null : LARGE, devices: 8, online: 4, relay_bytes: 10 * GB, storage: 10 * GB },
];
const payment = (id: string, status: string) => ({ id, created_at: "2026-11-04T10:00:00+00:00", month: "2026-11", amount: 500, currency: "usd", status });
const subscription = (over: Record<string, unknown> = {}) => ({ status: "active", active: true, plan: "small", cancel_at_period_end: false, current_period_end: "2026-12-04T10:00:00+00:00", ...over });
const none = { plans: plans(), current: null, manage_url: null, subscription: null, purchases: [] };
const onSmall = (over: Record<string, unknown> = {}) => ({ plans: plans(true), current: "small", manage_url: PORTAL, subscription: subscription(over), purchases: [] });
const usage = { devices: 1, online: 1, relay_bytes: 512 * 1024 ** 2, month: "2026-11", resets_at: "2026-12-01T00:00:00+00:00" };
const unpaid = { plan: null, paid: false, required: true, allowed: false, billing_url: "/app/#/account/billing", limits: null, usage: { ...usage, devices: 0, online: 0, relay_bytes: 0 } };
const small = { plan: "small", paid: true, required: true, allowed: true, billing_url: "/app/#/account/billing", limits: { devices: 2, online: 1, relay_bytes: GB, storage: 2 * GB }, usage };
const storage = { used: GB, limit: 2 * GB, files: 3, parts: [] };

afterEach(() => vi.useRealTimers());

describe("BillingTab", () => {
  it("offers the server's plans, by its names, with what each gives, to someone without a plan, and shows no usage", async () => {
    mockFetch({ [PLAN]: unpaid, [STORAGE]: storage, [BILLING]: none });
    render(<BillingTab />);
    const small_ = await screen.findByTestId("plan-small");
    expect(within(small_).getByText("Small")).toBeTruthy();
    expect(within(small_).getByText("$5.00 / month")).toBeTruthy();
    expect(within(small_).getByText("2 registered devices, 1 online at once")).toBeTruthy();
    expect(within(small_).getByText("1 GB of relay traffic a month")).toBeTruthy();
    expect(within(small_).getByText("2 GB of storage")).toBeTruthy();
    expect(within(small_).getByRole("link", { name: "Subscribe" }).getAttribute("href")).toBe(SMALL);
    const large = screen.getByTestId("plan-large");
    expect(within(large).getByText("Large")).toBeTruthy();
    expect(within(large).getByText("$15.00 / month")).toBeTruthy();
    expect(within(large).getByText("8 registered devices, 4 online at once")).toBeTruthy();
    expect(within(large).getByText("10 GB of relay traffic a month")).toBeTruthy();
    expect(within(large).getByText("10 GB of storage")).toBeTruthy();
    expect(within(large).getByRole("link", { name: "Subscribe" }).getAttribute("href")).toBe(LARGE);
    expect(screen.queryByText("Current plan")).toBeNull();
    expect(screen.queryByRole("region", { name: "Usage" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Manage subscription" })).toBeNull();
    expect(screen.getByText("No payments yet.")).toBeTruthy();
  });

  it("shows a free plan as Free, with no Subscribe, and says which plans share pages publicly", async () => {
    const free = { id: "free", name: "Free", amount: 0, currency: "usd", buy_url: null, devices: 2, online: 1, relay_bytes: GB, storage: GB, public_pages: false };
    const listed = [free, ...plans().map((p) => ({ ...p, public_pages: true }))];
    mockFetch({ [PLAN]: { ...small, plan: "free", paid: false }, [STORAGE]: storage, [BILLING]: { ...none, plans: listed, current: "free" } });
    render(<BillingTab />);
    const card = await screen.findByTestId("plan-free");
    expect(within(card).getAllByText("Free")).toHaveLength(2);
    expect(within(card).getByText("Current plan")).toBeTruthy();
    expect(within(card).getByText("Pages stay private (no public sharing)")).toBeTruthy();
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(screen.getByTestId("plan-small")).getByText("Share pages publicly")).toBeTruthy();
    expect(within(screen.getByTestId("plan-small")).getByRole("link", { name: "Subscribe" })).toBeTruthy();
    expect(card.parentElement?.className).toContain("sm:grid-cols-3");
  });

  it("marks the plan subscribed to, shows its usage, offers Manage subscription, and lists the payments", async () => {
    mockFetch({ [PLAN]: small, [STORAGE]: storage, [BILLING]: { ...onSmall(), purchases: [payment("in_1", "paid"), payment("in_2", "failed")] } });
    render(<BillingTab />);
    expect((await screen.findByRole("link", { name: "Manage subscription" })).getAttribute("href")).toBe(PORTAL);
    expect(within(screen.getByTestId("plan-small")).getByText("Current plan")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Subscribe" })).toBeNull();
    expect(screen.getByText("To change plan or cancel, use Manage subscription.")).toBeTruthy();
    expect(screen.getByText("Your Small plan renews on Dec 4, 2026.")).toBeTruthy();
    expect(await screen.findByText("1 of 2 registered devices")).toBeTruthy();
    expect(screen.getByText("1 of 1 devices online now")).toBeTruthy();
    expect(screen.getByText("512 MB of 1 GB relay traffic this month")).toBeTruthy();
    expect(screen.getByText(/It starts over on December 1\./)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Relay traffic" }).getAttribute("aria-valuenow")).toBe(String(512 * 1024 ** 2));
    expect(await screen.findByText("1 GB of 2 GB used")).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Nov 4, 2026", "$5.00", "Paid"],
      ["Nov 4, 2026", "$5.00", "Failed"],
    ]);
  });

  it("says when a cancelled plan ends, when a renewal is being retried, and names a plan it cannot tell as paid", async () => {
    mockFetch({ [PLAN]: small, [STORAGE]: storage, [BILLING]: { ...onSmall({ plan: "large", cancel_at_period_end: true }), current: "large" } });
    const { unmount } = render(<BillingTab />);
    expect(await screen.findByText("Your Large plan ends on Dec 4, 2026.")).toBeTruthy();
    unmount();
    mockFetch({ [PLAN]: small, [STORAGE]: storage, [BILLING]: onSmall({ status: "past_due" }) });
    const second = render(<BillingTab />);
    expect((await screen.findByText(/Your last payment did not go through/)).className).toContain("text-amber-700");
    second.unmount();
    mockFetch({ [PLAN]: reply(503, { detail: "down" }), [BILLING]: { ...onSmall({ plan: null, current_period_end: null }), current: null, manage_url: null } });
    render(<BillingTab />);
    expect(await screen.findByText("You're on the paid plan.")).toBeTruthy();
    expect(screen.queryByText(/To change plan/)).toBeNull();
  });

  it("offers a plan's free trial, with or without a card, and says when a trial ends", async () => {
    const trials = plans().map((p, i) => ({ ...p, trial: { days: 7, card: i === 1 } }));
    mockFetch({ [PLAN]: unpaid, [STORAGE]: storage, [BILLING]: { ...none, plans: trials } });
    const { unmount } = render(<BillingTab />);
    const small_ = await screen.findByTestId("plan-small");
    expect(within(small_).getByText("7-day free trial, no card needed")).toBeTruthy();
    expect(within(small_).getByRole("link", { name: "Start free trial" }).getAttribute("href")).toBe(SMALL);
    expect(within(screen.getByTestId("plan-large")).getByText("7-day free trial")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Subscribe" })).toBeNull();
    unmount();
    // On the trial: its end, and no trial offered on any card any more.
    mockFetch({ [PLAN]: small, [STORAGE]: storage, [BILLING]: { ...onSmall({ status: "trialing" }), plans: plans(true).map((p) => ({ ...p, trial: { days: 7, card: false } })) } });
    render(<BillingTab />);
    expect(await screen.findByText("Your free trial of Small ends on Dec 4, 2026. To keep your plan after that, add a card in Manage subscription.")).toBeTruthy();
    expect(screen.queryByText(/free trial, no card/)).toBeNull();
    expect(subscriptionLine(subscription({ status: "trialing", cancel_at_period_end: true }) as never)).toEqual({ key: "profile.billing.ending", withDate: true });
  });

  it("says the plans are not available until the payment provider is set up", async () => {
    mockFetch({ [PLAN]: unpaid, [BILLING]: { ...none, plans: plans(true) } });
    render(<BillingTab />);
    expect(await screen.findByText("Plans are not available yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("reads again when the person comes back, and once more a little later", async () => {
    let paid: unknown[] = [];
    mockFetch({ [PLAN]: () => (paid.length ? small : unpaid), [STORAGE]: storage, [BILLING]: () => (paid.length ? { ...onSmall(), purchases: paid } : none) });
    render(<BillingTab />);
    expect(await screen.findByText("No payments yet.")).toBeTruthy();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    act(() => void window.dispatchEvent(new Event("focus")));
    // The payment provider's word arrives just after the person is back.
    paid = [payment("in_9", "paid")];
    await act(async () => void vi.advanceTimersByTime(RETRY_MS));
    expect(await screen.findByText("Paid")).toBeTruthy();
    expect(await screen.findByText("1 of 2 registered devices")).toBeTruthy();
  });

  it("says why the payments could not be read", async () => {
    mockFetch({ [PLAN]: unpaid, [BILLING]: reply(503, { detail: "Wysebee Cloud is down." }) });
    render(<BillingTab />);
    expect(await screen.findByText(/Wysebee Cloud is down/)).toBeTruthy();
  });

  it("says nothing of a subscription that gives no plan any more", () => {
    expect(subscriptionLine(null)).toBeNull();
    expect(subscriptionLine(subscription({ status: "canceled", active: false }) as never)).toBeNull();
    expect(subscriptionLine(subscription({ current_period_end: null }) as never)).toEqual({ key: "profile.billing.activeNoDate", withDate: false });
  });

  it("offers Manage subscription without a line for a subscription that ended", async () => {
    mockFetch({ [PLAN]: unpaid, [STORAGE]: storage, [BILLING]: { ...none, manage_url: PORTAL, subscription: subscription({ status: "canceled", active: false }) } });
    render(<BillingTab />);
    expect((await screen.findByRole("link", { name: "Manage subscription" })).getAttribute("href")).toBe(PORTAL);
    expect(screen.queryByText(/Your .* plan/)).toBeNull();
  });

  it("colours a bar amber near its limit and red at it, and shows no usage without a plan", () => {
    const near = { ...small, usage: { ...usage, devices: 2, online: 1, relay_bytes: 0.85 * GB } };
    const { container, unmount } = render(<PlanUsage status={near as never} />);
    const bars = [...container.querySelectorAll('[role="progressbar"] > div')].map((b) => b.className);
    expect(bars[0]).toContain("bg-red-500");
    expect(bars[1]).toContain("bg-red-500");
    expect(bars[2]).toContain("bg-amber-500");
    unmount();
    expect(render(<PlanUsage status={unpaid as never} />).container.innerHTML).toBe("");
  });

  it("fills a usage bar towards its limit, and full past it", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(4, 3)).toBe(100);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(1, 0)).toBe(100);
  });

  it("writes money in the currency's own units, and copes with one it does not know", () => {
    expect(money(1250, "usd", "en")).toBe("$12.50");
    expect(money(2000, "jpy", "en")).toBe("¥2,000");
    expect(money(2000, "eur", "fr")).toMatch(/20,00\s€/);
    expect(money(2000, "??", "en")).toBe("20.00 ??");
  });
});
