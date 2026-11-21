import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../../i18n";
import { AgentAvatar } from "./AgentAvatar";

describe("AgentAvatar", () => {
  it("renders an image avatar", () => {
    render(<AgentAvatar avatar=" https://x/a.png " label="Bee" />);
    const img = screen.getByRole("img", { name: "Bee avatar" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://x/a.png");
  });

  it("renders an emoji glyph", () => {
    render(<AgentAvatar avatar="🐝" size={20} className="extra" />);
    const box = screen.getByRole("img", { name: "agent avatar" });
    expect(box.tagName).toBe("DIV");
    expect(box.textContent).toBe("🐝");
    expect(box.className).toContain("extra");
  });

  it("falls back to the Wysebee app icon", () => {
    render(<AgentAvatar avatar={null} label="Wysebee" size={28} />);
    const icon = screen.getByRole("img", { name: "Wysebee avatar" }) as HTMLImageElement;
    expect(icon.tagName).toBe("IMG");
    expect(icon.getAttribute("src")).toMatch(/wysebee-icon/);
    expect(icon.style.width).toBe("28px");
    render(<AgentAvatar avatar="   " />);
    expect((screen.getByRole("img", { name: "agent avatar" }) as HTMLImageElement).getAttribute("src")).toMatch(/wysebee-icon/);
  });

  it("shows the agent's presence as a dot, as Slack does a person's", () => {
    const { rerender, container } = render(<AgentAvatar avatar="🐝" label="Bee" size={18} status="online" />);
    expect(screen.getByRole("img", { name: "Online" })).toBeTruthy();
    expect(container.querySelector("[data-presence='online']")).toBeTruthy();
    rerender(<AgentAvatar avatar="🐝" label="Bee" status="offline" />);
    expect(screen.getByRole("img", { name: "Offline" }).className).toContain("ring-stone-400");
    rerender(<AgentAvatar avatar="🐝" label="Bee" status={null} />);
    expect(screen.queryByRole("img", { name: "Offline" })).toBeNull();
  });
});
