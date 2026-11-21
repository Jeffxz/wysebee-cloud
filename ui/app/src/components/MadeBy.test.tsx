import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "../i18n";
import { MadeBy } from "./MadeBy";

const sam = { id: "u1", name: "Sam", email: "sam@x.com" };

describe("MadeBy", () => {
  it("names who made it and, when another, who changed it last", () => {
    const { rerender, container } = render(<MadeBy made={sam} changed={sam} me="" />);
    expect(screen.getByText("Made by Sam")).toBeTruthy();
    rerender(<MadeBy made={sam} me="" />);
    expect(screen.getByText("Made by Sam")).toBeTruthy();
    // The signed-in person is "you" (by email, any case); else a name, an email, or someone.
    rerender(<MadeBy made={sam} changed={{ id: "u2", name: "", email: "lee@x.com" }} me="SAM@x.com" />);
    expect(screen.getByText("Made by you · Last changed by lee@x.com")).toBeTruthy();
    rerender(<MadeBy made={{ id: "u3", name: "", email: "" }} me="sam@x.com" className="custom" />);
    expect(screen.getByText("Made by someone").className).toBe("custom");
    rerender(<MadeBy made={null} me="" />);
    expect(container.textContent).toBe("");
  });
});
