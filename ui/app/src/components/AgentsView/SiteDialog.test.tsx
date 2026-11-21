import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { SiteDialog } from "./SiteDialog";

function setup(initial: { description: string; address: string }[] = [], kind: "news" | "gmail" = "news") {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<SiteDialog kind={kind} initial={initial} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}
const done = () => userEvent.click(screen.getByRole("button", { name: "Done" }));
const alert = () => screen.getByText(/:/, { selector: "div" }).textContent;

describe("SiteDialog on the web", () => {
  it("adds links, says what is wrong with each, and saves them trimmed", async () => {
    const { onSave } = setup();
    expect(screen.getByRole("dialog", { name: "Set up News" })).toBeTruthy();
    // One empty link to start with, and no trash while it is the only one.
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    await done();
    expect(alert()).toMatch(/News site 1: give a link that starts with https:\/\//);
    await userEvent.type(screen.getByLabelText("Link"), " https://news.example.com/ ");
    await done();
    expect(alert()).toMatch(/News site 1: say what it is for/);
    await userEvent.type(screen.getByLabelText("What it is for"), " Headlines ");
    // A second link the same as the first is refused; its trash takes it away again.
    await userEvent.click(screen.getByRole("button", { name: "Add another news site" }));
    await userEvent.type(screen.getAllByLabelText("Link")[1], "https://news.example.com/");
    await userEvent.type(screen.getAllByLabelText("What it is for")[1], "Again");
    await done();
    expect(alert()).toMatch(/News site 2: that link is already in the list/);
    await userEvent.click(screen.getByRole("button", { name: "Remove News site 2" }));
    expect(screen.getAllByLabelText("Link")).toHaveLength(1);
    await done();
    expect(onSave).toHaveBeenCalledWith([{ description: "Headlines", address: "https://news.example.com/" }]);
  });

  it("changes the links it was given, and closes on Escape, Close or outside it", async () => {
    const { onSave, onClose } = setup([{ description: "Inbox", address: "https://mail.google.com/mail/u/0/" }], "gmail");
    expect(screen.getByRole("dialog", { name: "Change your Gmail inboxes" })).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Link"));
    await userEvent.type(screen.getByLabelText("Link"), "https://example.com/");
    await done();
    expect(alert()).toMatch(/give a link that starts with https:\/\/mail\.google\.com\//);
    expect(onSave).not.toHaveBeenCalled();
    // A click inside does not close it.
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
