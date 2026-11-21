import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAppearance: vi.fn(async (): Promise<{ theme: string }> => ({ theme: "dark" })),
  saveAppearance: vi.fn(async (theme: string) => ({ theme })),
}));
vi.mock("./api", () => api);

import { applyTheme, loadTheme, setTheme, startTheme, useTheme } from "./theme";

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().classList.remove("dark");
  root().style.colorScheme = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme", () => {
  it("starts dark, or as last shown, and anything unknown is dark", () => {
    startTheme();
    expect(root().classList.contains("dark")).toBe(true);
    expect(root().style.colorScheme).toBe("dark");
    localStorage.setItem("wysebee.theme", "light");
    startTheme();
    expect(root().classList.contains("dark")).toBe(false);
    expect(root().style.colorScheme).toBe("light");
    localStorage.setItem("wysebee.theme", "neon");
    startTheme();
    expect(root().classList.contains("dark")).toBe(true);
    applyTheme("light");
    applyTheme(undefined);
    expect(root().classList.contains("dark")).toBe(true);
  });

  it("still shows a look when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    startTheme();
    expect(root().classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("reads the saved look, quietly keeping the shown one when it cannot", async () => {
    api.fetchAppearance.mockResolvedValueOnce({ theme: "light" });
    await loadTheme();
    expect(root().classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("wysebee.theme")).toBe("light");
    api.fetchAppearance.mockRejectedValueOnce(new Error("down"));
    await loadTheme();
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("switches at once, saves to the cloud, and says when it could not", async () => {
    applyTheme("dark");
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBe("dark");
    await act(() => setTheme("light"));
    expect(result.current).toBe("light");
    expect(api.saveAppearance).toHaveBeenLastCalledWith("light");
    api.saveAppearance.mockRejectedValueOnce(new Error("Cloud down."));
    await act(() => expect(setTheme("dark")).rejects.toThrow("Cloud down."));
    expect(result.current).toBe("dark");
  });
});
