import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";

const calls = vi.hoisted(() => ({
  cloudFetch: vi.fn(async (..._args: unknown[]) => new Response(JSON.stringify({ deleted: true }))),
  signOut: vi.fn(async () => {}),
}));
vi.mock("../../cloud/data", () => ({ cloudFetch: calls.cloudFetch }));
vi.mock("../../cloud/host", () => ({ cloudHost: { signOut: calls.signOut } }));

import { DeleteAccountSection } from "./DeleteAccount";

beforeEach(() => {
  calls.cloudFetch.mockClear();
  calls.signOut.mockClear();
});

describe("DeleteAccountSection", () => {
  it("asks first, deletes only once understood, then signs out", async () => {
    render(<DeleteAccountSection />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Delete for good" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.click(screen.getByLabelText("I understand this cannot be undone."));
    await userEvent.click(confirm);
    expect(calls.cloudFetch).toHaveBeenCalledWith("/api/v1/account", { method: "DELETE" });
    await waitFor(() => expect(calls.signOut).toHaveBeenCalled());
  });

  it("shows the cloud's refusal and stays signed in", async () => {
    calls.cloudFetch.mockRejectedValueOnce(new Error("Your subscription could not be cancelled, so nothing was deleted. Try again."));
    render(<DeleteAccountSection />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(screen.getByLabelText("I understand this cannot be undone."));
    await userEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByText(/nothing was deleted/)).toBeTruthy();
    expect(calls.signOut).not.toHaveBeenCalled();
  });

  it("shows a refusal that is not an Error as its text", async () => {
    calls.cloudFetch.mockRejectedValueOnce("offline");
    render(<DeleteAccountSection />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.click(screen.getByLabelText("I understand this cannot be undone."));
    await userEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(calls.signOut).not.toHaveBeenCalled();
  });

  it("cancels with Escape", async () => {
    render(<DeleteAccountSection />);
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
