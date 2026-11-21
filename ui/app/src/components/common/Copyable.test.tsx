import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { Copyable } from "./Copyable";

describe("Copyable", () => {
  it("copies its value and shows a tick for a moment", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<Copyable value="https://x.example/mcp" label="address" />);
      expect(screen.getByText("https://x.example/mcp")).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "Copy address" }));
      expect(writeText).toHaveBeenCalledWith("https://x.example/mcp");
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
