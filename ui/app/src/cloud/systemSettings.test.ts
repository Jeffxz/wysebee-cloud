import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accessToken: vi.fn(async () => "tok"),
  reauthenticate: vi.fn(async () => {}),
  currentProfile: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
}));
vi.mock("./auth", () => auth);

import { dispatch } from "./router";
import { usageAnalyticsOn } from "./systemSettings";

async function call(method: string, path: string, body?: unknown) {
  const r = await dispatch(method, path, body === undefined ? undefined : JSON.stringify(body));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null };
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake Wysebee Cloud holding the settings row (`null`: none yet), recording the writes. */
function cloud(row: unknown, status = 200) {
  const writes: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        writes.push(JSON.parse(String(init.body)));
        return ok(writes[writes.length - 1]);
      }
      return row === null ? ok({ detail: "Not found" }, 404) : ok(row, status);
    }),
  );
  return writes;
}

describe("Send usage analytics on the web: the setting that follows the person", () => {
  it("is on until turned off, here or in Wysebee Desktop", async () => {
    cloud(null);
    expect((await call("GET", "/api/v1/system/settings")).body).toEqual({ telemetry_enabled: true });
    expect(await usageAnalyticsOn()).toBe(true);
    cloud({ settings_id: "default", config: { language: "ja", telemetry_enabled: false } });
    expect((await call("GET", "/api/v1/system/settings")).body).toEqual({ telemetry_enabled: false });
    expect(await usageAnalyticsOn()).toBe(false);
    // A row without settings is the defaults.
    cloud({ settings_id: "default", config: null });
    expect(await usageAnalyticsOn()).toBe(true);
  });

  it("counts as off when it cannot be read: a choice that may be off is never overridden", async () => {
    cloud({ detail: "down" }, 500);
    expect(await usageAnalyticsOn()).toBe(false);
    expect((await call("GET", "/api/v1/system/settings")).status).toBe(500);
  });

  it("is written into the row, keeping the desktop's other settings", async () => {
    const writes = cloud({ settings_id: "default", config: { language: "fr", update_check_enabled: false } });
    expect(await call("PUT", "/api/v1/system/settings", { telemetry_enabled: false })).toEqual({ status: 200, body: { telemetry_enabled: false } });
    expect(writes).toEqual([{ config: { language: "fr", update_check_enabled: false, telemetry_enabled: false } }]);
    expect((await call("PUT", "/api/v1/system/settings", { telemetry_enabled: "no" })).status).toBe(422);
    expect((await call("PUT", "/api/v1/system/settings")).status).toBe(422);
  });
});
