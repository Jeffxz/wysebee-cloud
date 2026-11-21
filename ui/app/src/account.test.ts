import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({ profile: null as { sub: string; name: string; email: string } | null, reads: 0 }));
vi.mock("./cloud/auth", () => ({
  currentProfile: async () => {
    who.reads += 1;
    return who.profile;
  },
}));

import { loadAccount, refreshAccount, useAccount } from "./account";

describe("account", () => {
  it("is who the page signed in as, read once, and again when asked", async () => {
    who.profile = { sub: "s", name: "Sam", email: "sam@x" };
    const { result } = renderHook(() => useAccount());
    await waitFor(() => expect(result.current.status).toEqual({ signed_in: true, username: "", email: "sam@x", name: "Sam" }));
    const reads = who.reads;
    await loadAccount();
    expect(who.reads).toBe(reads);
    who.profile = null;
    await act(() => refreshAccount());
    expect(result.current.status).toEqual({ signed_in: false, username: "", email: "", name: "" });
  });
});
