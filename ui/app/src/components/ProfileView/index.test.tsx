import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";

type Profile = { display_name: string; avatar: string | null };
const store = vi.hoisted(() => ({
  current: null as Profile | null,
  updateProfile: vi.fn(async (change: Partial<Profile>) => change as Profile),
}));
vi.mock("../../profile", async (orig) => ({
  ...(await orig<typeof import("../../profile")>()),
  loadProfile: () => {},
  useProfile: () => store.current,
  updateProfile: store.updateProfile,
}));
const account = vi.hoisted(() => ({ name: "Ann Lee" }));
vi.mock("../../account", () => ({
  useAccount: () => ({ status: { signed_in: true, username: "", email: "ann@x.io", name: account.name } }),
}));
const edition = vi.hoisted(() => ({ self: false, signOut: true, billing: true }));
vi.mock("../../cloud/auth", async (orig) => ({
  ...(await orig<typeof import("../../cloud/auth")>()),
  selfHosted: () => edition.self,
  billingEnabled: () => edition.billing,
  canSignOut: () => edition.signOut,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { cloudHost } from "../../cloud/host";
import { AccountView, ProfileView, accountTabFromSegment } from ".";

beforeEach(() => {
  edition.self = false;
  edition.signOut = true;
  edition.billing = true;
  account.name = "Ann Lee";
  store.current = { display_name: "", avatar: null };
  store.updateProfile.mockClear();
});

describe("ProfileView", () => {
  it("shows the account's name until a display name is chosen, and saves one", async () => {
    render(<ProfileView />);
    expect(screen.getAllByText("Ann Lee").length).toBeGreaterThan(0);
    expect(screen.getByText("ann@x.io")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Display name"), " Annie ");
    await userEvent.click(save);
    expect(store.updateProfile).toHaveBeenCalledWith({ display_name: "Annie" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Profile saved."));
  });

  it("reports a save the cloud refuses", async () => {
    store.updateProfile.mockRejectedValueOnce(new Error("Too long."));
    render(<ProfileView />);
    await userEvent.type(screen.getByLabelText("Display name"), "X{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too long."));
  });

  it("changes the picture through the picker, and removes it", async () => {
    store.current = { display_name: "Ann", avatar: "🦊" };
    render(<ProfileView />);
    await userEvent.click(screen.getByRole("button", { name: "Change your picture" }));
    await userEvent.click(screen.getByRole("button", { name: "Use 🐝" }));
    expect(store.updateProfile).toHaveBeenCalledWith({ avatar: "🐝" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Change your picture" }));
    await userEvent.click(screen.getByRole("button", { name: "Use default" }));
    expect(store.updateProfile).toHaveBeenLastCalledWith({ avatar: null });
  });

  it("names a refusal that is not an Error, and is You with no name at all", async () => {
    account.name = "";
    store.updateProfile.mockRejectedValueOnce("offline");
    render(<ProfileView />);
    expect(screen.getByText("You")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Display name"), "X{Enter}");
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("offline"));
  });

  it("opens the picker on no picture yet", async () => {
    render(<ProfileView />);
    await userEvent.click(screen.getByRole("button", { name: "Change your picture" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("signs out from the page, once", async () => {
    const signOut = vi.spyOn(cloudHost, "signOut").mockResolvedValue();
    render(<ProfileView />);
    const button = screen.getByRole("button", { name: "Sign out" }) as HTMLButtonElement;
    await userEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });
});

describe("AccountView", () => {
  it("shows Profile first, and Billing on its tab", async () => {
    const onSelectTab = vi.fn();
    const { rerender } = render(<AccountView onSelectTab={onSelectTab} />);
    expect(screen.getByRole("tab", { name: "Profile" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Billing" }));
    expect(onSelectTab).toHaveBeenLastCalledWith("billing");
    rerender(<AccountView tab="billing" onSelectTab={onSelectTab} />);
    expect(screen.getByRole("tab", { name: "Billing" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByLabelText("Display name")).toBeNull();
    expect(await screen.findByText("Payment history")).toBeTruthy();
  });

  it("reads a tab from the URL, the first for anything else", () => {
    expect(accountTabFromSegment("billing")).toBe("billing");
    expect(accountTabFromSegment("profile")).toBe("profile");
    expect(accountTabFromSegment("nope")).toBe("profile");
    expect(accountTabFromSegment(undefined)).toBe("profile");
  });
});

describe("on a server without plans", () => {
  it("has no Billing tab, and shows storage on Profile", async () => {
    edition.billing = false;
    render(<AccountView tab="billing" onSelectTab={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Billing" })).toBeNull();
    expect(screen.getByLabelText("Display name")).toBeTruthy();
    expect(await screen.findByText("Storage")).toBeTruthy();
  });
});

describe("on a self-hosted server", () => {
  it("has no Billing, sign-out without a token, or account deletion", () => {
    edition.self = true;
    edition.billing = false;
    edition.signOut = false;
    render(<AccountView tab="billing" onSelectTab={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Billing" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    expect(screen.queryByText(/plan/i)).toBeNull();
    expect(screen.queryByText(/delete/i)).toBeNull();
  });

  it("can forget its token", () => {
    edition.self = true;
    render(<ProfileView />);
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
