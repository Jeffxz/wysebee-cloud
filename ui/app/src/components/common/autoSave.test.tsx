import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { SaveBar, hasUnsavedEdits } from "./autoSave";

describe("SaveBar", () => {
  it("shows only while dirty and counts open editors", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const { rerender } = render(<SaveBar dirty={false} onSave={onSave} onDiscard={onDiscard} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(hasUnsavedEdits()).toBe(false);
    rerender(<SaveBar dirty onSave={onSave} onDiscard={onDiscard} note="Model saved" />);
    expect(hasUnsavedEdits()).toBe(true);
    expect(screen.getByText("Model saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onSave).toHaveBeenCalled();
    expect(onDiscard).toHaveBeenCalled();
    rerender(<SaveBar dirty saving onSave={onSave} onDiscard={onDiscard} />);
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    act(() => rerender(<SaveBar dirty={false} onSave={onSave} onDiscard={onDiscard} />));
    expect(hasUnsavedEdits()).toBe(false);
  });
});
