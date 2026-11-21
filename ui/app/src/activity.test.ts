import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockFetch, reply } from "../../test/fetch";
import { useFetchTransport } from "../../test/transport";
import { ACTIVITY_CHANGED } from "./api";
import { useUnread } from "./activity";

useFetchTransport();

describe("useUnread", () => {
  it("reads the count, follows the change feed, and reads again when the window comes back", async () => {
    const f = mockFetch({ "GET /api/v1/notifications/unread": { unread: 2 } });
    const { result, unmount } = renderHook(() => useUnread());
    await waitFor(() => expect(result.current).toBe(2));
    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVITY_CHANGED, { detail: { unread: 5 } }));
    });
    expect(result.current).toBe(5);
    f.set("GET /api/v1/notifications/unread", { unread: 1 });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(result.current).toBe(1));
    // A failed read leaves it as it was.
    f.set("GET /api/v1/notifications/unread", reply(503, { detail: "down" }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(f.to("GET /api/v1/notifications/unread")).toHaveLength(3));
    expect(result.current).toBe(1);
    // An answer that comes after it is gone is dropped.
    f.set("GET /api/v1/notifications/unread", { unread: 9 });
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    unmount();
    await waitFor(() => expect(f.to("GET /api/v1/notifications/unread")).toHaveLength(4));
  });
});
