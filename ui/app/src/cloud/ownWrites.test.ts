import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_ECHO_MS, ownWriteRecent, resetOwnWrites, trackWrite } from "./ownWrites";

vi.mock("./auth", () => ({ accessToken: vi.fn(async () => "t"), reauthenticate: vi.fn(async () => {}) }));

import { cloudFetch } from "./data";

beforeEach(() => resetOwnWrites());
afterEach(() => vi.unstubAllGlobals());

describe("this page's own writes", () => {
  it("counts a write while it runs and for a moment after, even when it fails", async () => {
    expect(ownWriteRecent()).toBe(false);
    let finish!: (v: string) => void;
    const running = trackWrite(() => new Promise<string>((r) => (finish = r)));
    expect(ownWriteRecent(Date.now() + 10 * OWN_ECHO_MS)).toBe(true);
    finish("done");
    expect(await running).toBe("done");
    const ended = Date.now();
    expect(ownWriteRecent(ended)).toBe(true);
    expect(ownWriteRecent(ended + OWN_ECHO_MS + 1)).toBe(false);

    await expect(trackWrite(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(ownWriteRecent()).toBe(true);
    expect(ownWriteRecent(Date.now() + OWN_ECHO_MS + 1)).toBe(false);
  });

  it("is what cloudFetch counts: its writes, not its reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await cloudFetch("/api/v1/tasks");
    await cloudFetch("/api/v1/tasks", { method: "head" });
    expect(ownWriteRecent()).toBe(false);
    await cloudFetch("/api/v1/tasks/t1", { method: "PUT", body: "{}" });
    expect(ownWriteRecent()).toBe(true);
  });
});
