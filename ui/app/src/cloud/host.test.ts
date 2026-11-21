import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  signIn: vi.fn(async () => ({})),
  currentProfile: vi.fn(async (): Promise<{ sub: string; name: string; email: string } | null> => null),
  signOut: vi.fn(async () => {}),
  startChangeFeed: vi.fn(),
  dispatch: vi.fn(async () => new Response(null, { status: 204 })),
  cloudFetch: vi.fn(async () => new Response(null, { status: 204 })),
  startTelemetry: vi.fn(),
  usageAnalyticsOn: vi.fn(async () => true),
  accessToken: vi.fn(async () => "tok"),
}));
const accessToken = m.accessToken;
vi.mock("./systemSettings", () => ({ usageAnalyticsOn: m.usageAnalyticsOn }));
vi.mock("../telemetry", () => ({ startTelemetry: m.startTelemetry }));
vi.mock("./data", () => ({ cloudFetch: m.cloudFetch }));
vi.mock("./auth", () => ({ signIn: m.signIn, currentProfile: m.currentProfile, signOut: m.signOut, analyticsOn: () => true, accessToken: m.accessToken }));
vi.mock("./events", () => ({ startChangeFeed: m.startChangeFeed }));
vi.mock("./router", () => ({ dispatch: m.dispatch }));

import { cloudHost } from "./host";

describe("cloudHost", () => {
  it("signs in, remembers who, and listens to the change feed", async () => {
    expect(cloudHost.account()).toBeNull();
    await cloudHost.start();
    expect(m.signIn).toHaveBeenCalled();
    expect(m.startChangeFeed).toHaveBeenCalled();
    expect(cloudHost.account()).toBeNull();
    expect(m.cloudFetch).not.toHaveBeenCalled();

    m.currentProfile.mockResolvedValueOnce({ sub: "s", name: "Ann", email: "a@x.io" });
    await cloudHost.start();
    expect(cloudHost.account()).toEqual({ name: "Ann", email: "a@x.io" });
    expect(m.cloudFetch).toHaveBeenCalledWith("/api/v1/me", { method: "PUT", body: JSON.stringify({ email: "a@x.io", name: "Ann" }) });
    // Analytics start for them, posted with their token, as they chose (on here).
    await vi.waitFor(() => expect(m.startTelemetry).toHaveBeenCalledWith({ on: true, accessToken, enabled: true }));
    // Turned off: started off, so nothing is sent.
    m.usageAnalyticsOn.mockResolvedValueOnce(false);
    m.currentProfile.mockResolvedValueOnce({ sub: "s", name: "Ann", email: "a@x.io" });
    await cloudHost.start();
    await vi.waitFor(() => expect(m.startTelemetry).toHaveBeenLastCalledWith({ on: true, accessToken, enabled: false }));

    // Saying who failed: the page carries on.
    m.currentProfile.mockResolvedValueOnce({ sub: "s", name: "Ann", email: "a@x.io" });
    m.cloudFetch.mockRejectedValueOnce(new Error("offline"));
    await cloudHost.start();
    expect(cloudHost.account()).toEqual({ name: "Ann", email: "a@x.io" });

    expect(cloudHost.request).toBe(m.dispatch);
    await cloudHost.signOut();
    expect(m.signOut).toHaveBeenCalled();
  });
});
