import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useOnReturn } from "./onReturn";

describe("useOnReturn", () => {
  it("calls back when the window regains focus or the tab is shown again, until unmounted", () => {
    const onReturn = vi.fn();
    const { unmount } = renderHook(() => useOnReturn(onReturn));
    window.dispatchEvent(new Event("focus"));
    const state = vi.spyOn(document, "visibilityState", "get");
    state.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onReturn).toHaveBeenCalledTimes(1);
    state.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onReturn).toHaveBeenCalledTimes(2);
    unmount();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onReturn).toHaveBeenCalledTimes(2);
    state.mockRestore();
  });
});
