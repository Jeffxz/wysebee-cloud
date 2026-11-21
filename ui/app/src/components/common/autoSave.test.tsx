import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import "../../i18n";
import { InlineFieldActions, SaveBar, fieldKeyDown, hasUnsavedEdits, useAutoSave } from "./autoSave";

describe("useAutoSave", () => {
  it("saves on change, one at a time, toasts, and survives failures", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    const save = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    const { rerender, result } = renderHook(({ k, enabled }) => useAutoSave(k, save, { enabled }), {
      initialProps: { k: "a", enabled: true },
    });
    expect(save).not.toHaveBeenCalled();
    rerender({ k: "b", enabled: true });
    rerender({ k: "c", enabled: true });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Saved", { id: "autosave:Saved" }));
    rerender({ k: "d", enabled: false });
    result.current.markSaved("e");
    rerender({ k: "e", enabled: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("uses a custom label", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => 1);
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ k }) => useAutoSave(k, save, { label: "Done" }), { initialProps: { k: "a" } });
    rerender({ k: "b" });
    await waitFor(() => expect(success).toHaveBeenCalledWith("Done", { id: "autosave:Done" }));
    renderHook(() => useAutoSave("z", save));
  });
});

describe("InlineFieldActions and fieldKeyDown", () => {
  it("saves and discards by button and key", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <>
        <InlineFieldActions onSave={onSave} onCancel={onCancel} what="name" />
        <input aria-label="in" onKeyDown={fieldKeyDown(onSave, onCancel)} />
        <textarea aria-label="ta" onKeyDown={fieldKeyDown(onSave, onCancel)} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard name change" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("in"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("in"), { key: "Escape" });
    fireEvent.keyDown(screen.getByLabelText("in"), { key: "a" });
    fireEvent.keyDown(screen.getByLabelText("ta"), { key: "Enter" });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

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
