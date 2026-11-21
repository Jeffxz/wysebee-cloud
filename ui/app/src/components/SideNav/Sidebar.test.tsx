import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { cloudHost } from "../../cloud/host";

const profile = vi.hoisted(() => ({ current: null as { display_name: string; avatar: string | null } | null }));
vi.mock("../../profile", () => ({ loadProfile: () => {}, useProfile: () => profile.current }));
const theme = vi.hoisted(() => ({ setTheme: vi.fn(async (_t: string) => {}), useTheme: vi.fn(() => "dark") }));
vi.mock("../../theme", () => theme);
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const activity = vi.hoisted(() => ({ unread: 0 }));
vi.mock("../../activity", () => ({ useUnread: () => activity.unread }));

import { Sidebar, initials } from "./Sidebar";

beforeEach(() => {
  profile.current = null;
  activity.unread = 0;
});

function signedInAs(name: string | null) {
  vi.spyOn(cloudHost, "account").mockReturnValue(name === null ? null : { name, email: "a@x.io" });
}

describe("Sidebar", () => {
  it("lists Home, Workspaces, Tasks, Agents, Activity and More, marks the open one, and selects", async () => {
    signedInAs("Ann Lee");
    const onSelect = vi.fn();
    const { rerender } = render(<Sidebar active="tasks" onSelect={onSelect} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items.slice(0, 6)).toEqual(["Home", "Workspaces", "Tasks", "Agents", "Activity", "More"]);
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    await userEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(onSelect).toHaveBeenCalledWith("tasks");
    // A section the rail does not list (none today) marks nothing.
    rerender(<Sidebar active={"other" as never} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-current")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onSelect).toHaveBeenCalledWith("home");
    await userEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(onSelect).toHaveBeenCalledWith("activity");
  });

  it("opens Skills, Tools and Devices from More, marked while one of them is open", async () => {
    signedInAs("Ann Lee");
    const onSelect = vi.fn();
    const { rerender } = render(<Sidebar active="tasks" onSelect={onSelect} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-current")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(more);
    const menu = screen.getByRole("menu", { name: "More" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Skills", "Tools", "Devices"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Tools" }));
    expect(onSelect).toHaveBeenLastCalledWith("tools");
    expect(screen.queryByRole("menu")).toBeNull();
    // More again, Escape and a click elsewhere close it.
    await userEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(more);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(more);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(more);
    await userEvent.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    rerender(<Sidebar active="skills" onSelect={onSelect} />);
    expect(more.getAttribute("aria-current")).toBe("page");
    await userEvent.click(more);
    expect(screen.getByRole("menuitem", { name: "Skills" }).getAttribute("aria-current")).toBe("page");
    await userEvent.click(screen.getByRole("menuitem", { name: "Skills" }));
    expect(onSelect).toHaveBeenLastCalledWith("skills");
  });

  it("ends with Settings, below the person's button, as on the desktop", async () => {
    signedInAs("Ann Lee");
    const onSelect = vi.fn();
    const { rerender } = render(<Sidebar active="tasks" onSelect={onSelect} />);
    const items = screen.getAllByRole("listitem");
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(items[items.length - 1].contains(settings)).toBe(true);
    expect(items[items.length - 2].textContent).toBe("AL");
    expect(settings.getAttribute("aria-current")).toBeNull();
    await userEvent.click(settings);
    expect(onSelect).toHaveBeenCalledWith("settings");
    rerender(<Sidebar active="settings" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the person's initials and opens their Profile — no Sign out menu", async () => {
    signedInAs("Ann Lee");
    const onSelect = vi.fn();
    const { rerender } = render(<Sidebar active="tasks" onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "Profile: Ann Lee" });
    expect(button.textContent).toBe("AL");
    expect(button.getAttribute("aria-current")).toBeNull();
    await userEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("profile");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Sign out")).toBeNull();
    rerender(<Sidebar active="profile" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Profile: Ann Lee" }).getAttribute("aria-current")).toBe("page");
  });

  it("shows the display name and picture the profile chose", () => {
    signedInAs("Ann Lee");
    profile.current = { display_name: "Annie", avatar: "🦊" };
    render(<Sidebar active="tasks" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Profile: Annie" }).textContent).toContain("🦊");
  });

  it("shows an icon when there is no name", () => {
    signedInAs(null);
    render(<Sidebar active="tasks" onSelect={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Profile" });
    expect(button.querySelector("svg")).toBeTruthy();
  });

  it("switches the look, and says so when it cannot be saved", async () => {
    signedInAs("Ann");
    theme.setTheme.mockRejectedValueOnce(new Error("offline"));
    render(<Sidebar active="tasks" onSelect={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: "Dark mode" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(sw);
    expect(theme.setTheme).toHaveBeenCalledWith("light");
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("offline")));
  });

  it("switches a light look to dark, and names a refusal that is not an Error", async () => {
    signedInAs("Ann");
    theme.useTheme.mockReturnValue("light");
    theme.setTheme.mockRejectedValueOnce("no network");
    render(<Sidebar active="tasks" onSelect={vi.fn()} />);
    const sw = screen.getByRole("switch", { name: "Dark mode" });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(sw.getAttribute("title")).toBe("Switch to dark");
    await userEvent.click(sw);
    expect(theme.setTheme).toHaveBeenCalledWith("dark");
    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("no network")));
    theme.useTheme.mockReturnValue("dark");
  });
});

describe("initials", () => {
  it("takes the first letters of the first and last words, or two of one word", () => {
    expect(initials("Ada Lovelace")).toBe("AL");
    expect(initials("ann marie lee")).toBe("AL");
    expect(initials("adalove")).toBe("AD");
    expect(initials("ada.love")).toBe("AL");
    expect(initials("   ")).toBe("");
    // Characters, not UTF-16 units: an emoji is never cut in half.
    expect(initials("😀 Smile")).toBe("😀S");
  });

  it("badges Activity with the unread count, up to 99+", async () => {
    signedInAs("Ann Lee");
    const onSelect = vi.fn();
    activity.unread = 3;
    const { rerender } = render(<Sidebar active="home" onSelect={onSelect} />);
    expect(screen.getByLabelText("3 unread").textContent).toBe("3");
    activity.unread = 120;
    rerender(<Sidebar active="activity" onSelect={onSelect} />);
    expect(screen.getByLabelText("120 unread").textContent).toBe("99+");
    await userEvent.click(screen.getByRole("button", { name: /Activity/ }));
    expect(onSelect).toHaveBeenCalledWith("activity");
    activity.unread = 0;
    rerender(<Sidebar active="home" onSelect={onSelect} />);
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });
});
