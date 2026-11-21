import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Hint } from "./Hint";

const tip = () => screen.queryByRole("tooltip");

describe("Hint", () => {
  it("shows its text on a click, inside a label without touching the field, and hides it again", async () => {
    const focused = vi.fn();
    render(
      <>
        <label>
          Handle <Hint text="What AI apps call it." />
          <input aria-label="Handle" onFocus={focused} />
        </label>
        <p>elsewhere</p>
      </>,
    );
    const icon = screen.getByRole("button", { name: "What AI apps call it." });
    expect(tip()).toBeNull();
    await userEvent.click(icon);
    expect(tip()?.textContent).toBe("What AI apps call it.");
    expect(icon.getAttribute("aria-expanded")).toBe("true");
    expect(focused).not.toHaveBeenCalled();
    // A click elsewhere closes it.
    fireEvent.mouseDown(screen.getByText("elsewhere"));
    expect(tip()).toBeNull();
    // A click on it again keeps it open; Escape closes it.
    fireEvent.click(icon);
    fireEvent.mouseDown(icon);
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Enter" });
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(tip()).toBeNull();
  });

  it("shows on hover and on focus, and hides when they leave", () => {
    render(<Hint text="More." />);
    const icon = screen.getByRole("button", { name: "More." });
    fireEvent.mouseEnter(icon.parentElement as HTMLElement);
    expect(tip()).not.toBeNull();
    fireEvent.mouseLeave(icon.parentElement as HTMLElement);
    expect(tip()).toBeNull();
    fireEvent.focus(icon);
    expect(tip()).not.toBeNull();
    fireEvent.blur(icon);
    expect(tip()).toBeNull();
  });
});
