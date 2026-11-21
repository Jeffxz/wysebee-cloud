import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { LocalProgramDialog } from "./LocalProgramDialog";

function setup(initial?: Parameters<typeof LocalProgramDialog>[0]["initial"]) {
  const props = { onSave: vi.fn(), onClose: vi.fn() };
  render(<LocalProgramDialog initial={initial} others={[]} {...props} />);
  return props;
}

describe("LocalProgramDialog on the web", () => {
  it("takes the program typed — no Browse… on a page — and its arguments, fixed or blanks", async () => {
    const { onSave } = setup();
    const dialog = screen.getByRole("dialog", { name: "New local program tool" });
    expect(within(dialog).queryByRole("button", { name: "Browse…" })).toBeNull();
    expect(within(dialog).getByText(/full path on that computer/)).toBeTruthy();
    expect(within(dialog).getByText("No arguments: the program runs on its own.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Tool name"), "say_it");
    await userEvent.type(within(dialog).getByLabelText("What it does"), "Speaks text");
    await userEvent.type(within(dialog).getByLabelText("Program"), "/usr/bin/say");
    // A fixed argument left empty is refused; then text, and a blank Wysebee fills.
    await userEvent.click(within(dialog).getByRole("button", { name: "Add argument" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tool" }));
    expect(within(dialog).getByText("A fixed argument needs some text, or remove it.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Text"), "-v");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add argument" }));
    const second = within(dialog).getByRole("group", { name: "Argument 2" });
    await userEvent.selectOptions(within(second).getByLabelText("Kind of argument"), "param");
    await userEvent.type(within(second).getByLabelText("Blank's name"), "text");
    await userEvent.type(within(second).getByLabelText("What Wysebee should put here"), "The words");
    expect(within(dialog).getByLabelText("What runs").textContent).toBe("/usr/bin/say -v <text>");
    // A third, taken back, and the blank turned to text and back.
    await userEvent.click(within(dialog).getByRole("button", { name: "Add argument" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove argument 3" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add tool" }));
    expect(onSave).toHaveBeenCalledWith({ name: "say_it", description: "Speaks text", command: "/usr/bin/say", args: [{ value: "-v" }, { param: "text", description: "The words" }] });
    await userEvent.selectOptions(within(second).getByLabelText("Kind of argument"), "value");
    expect(within(dialog).getByLabelText("What runs").textContent).toBe("/usr/bin/say -v ");
  });

  it("changes a tool as it was, and closes with Escape or a click outside, not inside", async () => {
    const { onSave, onClose } = setup({ name: "wc", description: "Count", command: "wc", args: [{ param: "", description: "" }] });
    const dialog = screen.getByRole("dialog", { name: "Change the local program tool" });
    expect(within(dialog).getByLabelText("What runs").textContent).toBe("wc <…>");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText(/A blank's name is lowercase/)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.clear(within(dialog).getByLabelText("Program"));
    expect(within(dialog).getByLabelText("What runs").textContent).toBe("… <…>");
    await userEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("allows at most 30 arguments", () => {
    setup({ name: "wc", description: "Count", command: "wc", args: Array.from({ length: 30 }, () => ({ value: "a" })) });
    expect((screen.getByRole("button", { name: "Add argument" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
