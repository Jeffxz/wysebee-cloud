import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { INSTRUCTIONS_MAX_LEN, InstructionsTab } from "./InstructionsTab";

function setup(over: Partial<Parameters<typeof InstructionsTab>[0]> = {}) {
  const props = {
    saved: "old",
    draft: "new",
    onDraftChange: vi.fn(),
    onSave: vi.fn(),
    canEdit: true,
    ...over,
  };
  return { props, ...render(<InstructionsTab {...props} />) };
}

describe("InstructionsTab", () => {
  it("edits, saves by shortcut, and discards", () => {
    const { props } = setup();
    const box = screen.getByRole("textbox", { name: "Instructions" });
    fireEvent.change(box, { target: { value: "x" } });
    expect(props.onDraftChange).toHaveBeenCalledWith("x");
    fireEvent.keyDown(box, { key: "s", metaKey: true });
    fireEvent.keyDown(box, { key: "S", ctrlKey: true });
    fireEvent.keyDown(box, { key: "s" });
    expect(props.onSave).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(props.onDraftChange).toHaveBeenLastCalledWith("old");
    expect(screen.getByText("3 characters")).toBeTruthy();
  });

  it("does nothing when clean, and refuses to save when too long", () => {
    const clean = setup({ draft: "old" });
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "s", metaKey: true });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(clean.props.onSave).not.toHaveBeenCalled();
    expect(clean.props.onDraftChange).not.toHaveBeenCalled();
    clean.unmount();
    const long = setup({ draft: "x".repeat(INSTRUCTIONS_MAX_LEN + 1) });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "s", ctrlKey: true });
    expect(long.props.onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Too long/)).toBeTruthy();
  });

  it("previews markdown, or the empty line", async () => {
    const { rerender, props } = setup({ draft: "# Hello" });
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Hello" })).toBeTruthy();
    rerender(<InstructionsTab {...props} draft="  " />);
    expect(screen.getByText("No instructions yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Write" }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("uses a task's wording", () => {
    setup({ kind: "task", draft: "" });
    expect(screen.getByRole("textbox", { name: "Plan" })).toBeTruthy();
  });

  it("is read-only without edit rights", () => {
    setup({ canEdit: false });
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  });
});
