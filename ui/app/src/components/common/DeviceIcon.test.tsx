import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { agentDevice, DeviceIcon, type DeviceKind } from "./DeviceIcon";

describe("agentDevice", () => {
  it("is a browser agent's browser, and nothing for an agent in Wysebee Cloud", () => {
    expect(agentDevice(true)).toEqual({ name: "Browser extension", kind: "chrome" });
    expect(agentDevice(false)).toBeNull();
    expect(agentDevice()).toBeNull();
    // By the paired device's type: a Windows PC, a Mac, a phone; an unknown type falls back.
    expect(agentDevice(false, "wysebee-windows")).toEqual({ name: "Windows PC", kind: "windows" });
    expect(agentDevice(false, "wysebee-osx")).toEqual({ name: "Mac", kind: "mac" });
    expect(agentDevice(false, "wysebee-linux")).toEqual({ name: "Linux machine", kind: "linux" });
    expect(agentDevice(false, "wysebee-android")).toEqual({ name: "Android phone", kind: "android" });
    expect(agentDevice(true, "wysebee-browser-chrome")).toEqual({ name: "Browser extension", kind: "chrome" });
    expect(agentDevice(true, "wysebee-browser-edge")).toEqual({ name: "Browser extension", kind: "chrome" });
    expect(agentDevice(false, null)).toBeNull();
  });
});

describe("DeviceIcon", () => {
  it.each<DeviceKind>(["mac", "windows", "linux", "android", "ios", "cloud", "other"])("draws %s, its name on hover", (kind) => {
    render(<DeviceIcon name="Galaxy 9+" kind={kind} />);
    const icon = screen.getByRole("img", { name: "Galaxy 9+" });
    expect(icon.getAttribute("title")).toBe("Galaxy 9+");
    expect(icon.getAttribute("data-device-kind")).toBe(kind);
    expect(icon.querySelector("svg")).toBeTruthy();
  });
});
