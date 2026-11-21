import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "../../i18n";
import { SettingsView } from ".";
import { DevicesView } from "./DevicesView";
import { settingsTabFromSegment } from "./tabs";

vi.mock("./DesktopsSection", () => ({ DesktopsSection: () => <div>desktops section</div> }));
vi.mock("./BrowsersSection", () => ({ BrowsersSection: ({ onOpenAgent }: { onOpenAgent: (name: string) => void }) => <button onClick={() => onOpenAgent("sky")}>browsers section</button> }));
vi.mock("./SystemTab", () => ({ SystemTab: () => <div>system tab</div> }));

describe("SettingsView on the web", () => {
  it("is System: the settings that follow the person — Connections is Devices on the rail now", async () => {
    const onSelectTab = vi.fn();
    render(<SettingsView onSelectTab={onSelectTab} />);
    expect(screen.getByRole("tab", { name: "System" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("system tab")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Connections" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "AI Providers" })).toBeNull();
    expect(screen.queryByText("desktops section")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "System" }));
    expect(onSelectTab).toHaveBeenCalledWith("system");
  });

  it("marks no tab for a pane it does not have (none today)", () => {
    render(<SettingsView tab={"other" as never} onSelectTab={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "System" }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("DevicesView", () => {
  it("shows Wysebee Cloud and the devices running an agent, then the browsers paired with the extension", async () => {
    const onOpenAgent = vi.fn();
    render(<DevicesView onOpenDevice={vi.fn()} onOpenAgent={onOpenAgent} />);
    expect(screen.getByText("Wysebee Cloud, the devices where your agents run, and the browsers paired with the Wysebee Agent extension.")).toBeTruthy();
    expect(screen.getByText("desktops section")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "browsers section" }));
    expect(onOpenAgent).toHaveBeenCalledWith("sky");
  });
});

describe("settingsTabFromSegment", () => {
  it("names a pane, and else the first", () => {
    expect(settingsTabFromSegment("system")).toBe("system");
    expect(settingsTabFromSegment("ai-providers")).toBe("system");
    expect(settingsTabFromSegment(undefined)).toBe("system");
  });
});
