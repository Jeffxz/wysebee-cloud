import { describe, expect, it } from "vitest";
import { mockFetch } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import { profileNow, updateProfile } from "./profile";

useFetchTransport();

describe("updateProfile", () => {
  it("saves a change and keeps what the server answered", async () => {
    const api = mockFetch({ "PUT /api/v1/profile": { display_name: "Annie", avatar: null } });
    expect(await updateProfile({ display_name: "Annie" })).toEqual({ display_name: "Annie", avatar: null });
    expect(api.to("PUT /api/v1/profile")[0].body).toEqual({ display_name: "Annie" });
    expect(profileNow()).toEqual({ display_name: "Annie", avatar: null });
  });
});

describe("the profile store", () => {
  it("reads once, shares the read, and keeps none when it fails", async () => {
    const { loadProfile, reloadProfile, useProfile } = await import("./profile");
    const { renderHook, waitFor } = await import("@testing-library/react");
    const api = mockFetch({ "GET /api/v1/profile": { display_name: "Sam", avatar: "🐝" } });
    const { result } = renderHook(() => useProfile());
    loadProfile();
    loadProfile();
    await waitFor(() => expect(result.current).toEqual({ display_name: "Sam", avatar: "🐝" }));
    expect(api.to("GET /api/v1/profile")).toHaveLength(1);
    mockFetch({ "GET /api/v1/profile": () => Promise.reject(new Error("offline")) });
    reloadProfile();
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toEqual({ display_name: "Sam", avatar: "🐝" });
  });

  it("names the person by their chosen name, else their account's", async () => {
    const { personNameOf } = await import("./profile");
    const account = { signed_in: true, username: "sam1", email: "", name: "" };
    expect(personNameOf({ display_name: "Annie", avatar: null }, account)).toBe("Annie");
    expect(personNameOf(null, account)).toBe("sam1");
    expect(personNameOf({ display_name: "", avatar: null }, { ...account, name: "Sam" })).toBe("Sam");
    expect(personNameOf(null, { ...account, signed_in: false })).toBe("");
    expect(personNameOf(null, null)).toBe("");
  });
});
