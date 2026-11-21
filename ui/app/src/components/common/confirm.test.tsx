import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { dialogs } from "./confirm";

async function open(message: string, action?: Parameters<typeof dialogs.confirm>[1]) {
  let answer!: Promise<boolean>;
  await act(async () => {
    answer = dialogs.confirm(message, action);
  });
  return { answer };
}

describe("dialogs.confirm", () => {
  it("asks in the app's own dialog and resolves true on the confirming button, then goes away", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { answer } = await open("Delete the skill 'x'?", { action: "delete" });
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete the skill 'x'?");
    // Something that cannot be undone starts on Cancel; the confirming button is red.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    const yes = screen.getByRole("button", { name: "Delete" });
    expect(yes.className).toContain("bg-red-700");
    await userEvent.click(yes);
    expect(await answer).toBe(true);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("says OK by default, starts there, keeps Tab on its buttons and resolves false on Cancel", async () => {
    const { answer } = await open("Go on?");
    const ok = screen.getByRole("button", { name: "OK" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(ok.className).not.toContain("bg-red-700");
    expect(document.activeElement).toBe(ok);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(cancel);
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(ok);
    await userEvent.keyboard("a");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await userEvent.click(cancel);
    expect(await answer).toBe(false);
  });

  it("resolves false on Escape or a click outside, once", async () => {
    const { answer: escaped } = await open("Leave?", { action: "leave" });
    await userEvent.keyboard("{Escape}");
    expect(await escaped).toBe(false);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    const { answer: outside } = await open("Unpair?", { action: "unpair" });
    const dialog = screen.getByRole("alertdialog");
    await userEvent.click(dialog); // inside: stays open
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    const backdrop = dialog.parentElement as HTMLElement;
    const unpair = screen.getByRole("button", { name: "Unpair" });
    // Both in the same moment: the first answer counts, the second is ignored.
    fireEvent.click(backdrop);
    fireEvent.click(unpair);
    expect(await outside).toBe(false);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });
});
