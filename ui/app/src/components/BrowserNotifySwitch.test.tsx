import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";

const notify = vi.hoisted(() => ({
  supported: true,
  on: false,
  permission: "default" as NotificationPermission,
  answer: "granted" as NotificationPermission,
}));
vi.mock("../browserNotify", () => ({
  browserNotifySupported: () => notify.supported,
  browserNotifyOn: () => notify.on,
  turnOnBrowserNotify: vi.fn(async () => notify.answer),
  turnOffBrowserNotify: vi.fn(),
}));

import { BrowserNotifySwitch } from "./BrowserNotifySwitch";

beforeEach(() => {
  notify.supported = true;
  notify.on = false;
  notify.permission = "default";
  notify.answer = "granted";
  vi.stubGlobal("Notification", { get permission() { return notify.permission; } });
});

const sw = () => screen.getByRole("switch", { name: "Browser notifications" });

describe("BrowserNotifySwitch", () => {
  it("turns on once the browser allows it, and off again", async () => {
    render(<BrowserNotifySwitch />);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    await userEvent.click(sw());
    expect(sw().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(sw());
    expect(sw().getAttribute("aria-checked")).toBe("false");
  });

  it("says where to allow them once the browser refuses, and is off", async () => {
    notify.answer = "denied";
    render(<BrowserNotifySwitch />);
    await userEvent.click(sw());
    expect(screen.getByText(/Blocked for this site/)).toBeTruthy();
    expect((sw() as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts on, or blocked, as the browser left it; and shows nothing without notifications", () => {
    notify.on = true;
    const { unmount } = render(<BrowserNotifySwitch />);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    unmount();
    notify.on = false;
    notify.permission = "denied";
    const blocked = render(<BrowserNotifySwitch />);
    expect(screen.getByText(/Blocked for this site/)).toBeTruthy();
    blocked.unmount();
    notify.supported = false;
    const { container } = render(<BrowserNotifySwitch />);
    expect(container.innerHTML).toBe("");
  });
});
