import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QrCode, qrModules } from "./QrCode";

describe("QrCode", () => {
  it("draws the smallest code that holds the text, with its finder patterns", () => {
    const short = qrModules("hi");
    expect(short).toHaveLength(21);
    // The top-left finder: a dark 7x7 ring around a light ring around a dark 3x3 core.
    expect(short[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(short[1][1]).toBe(false);
    expect(short[3][3]).toBe(true);
    expect(qrModules(`wysebee-agent:pair?offer=${"T".repeat(43)}&from=https%3A%2F%2Fapp.wysebee.com`).length).toBeGreaterThan(21);
  });

  it("is black on white, with a quiet zone, named for a screen reader", () => {
    render(<QrCode text="hi" label="Pairing QR code" size={100} />);
    const svg = screen.getByRole("img", { name: "Pairing QR code" });
    expect(svg.getAttribute("viewBox")).toBe("0 0 29 29");
    expect(svg.getAttribute("width")).toBe("100");
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#fff");
    const d = svg.querySelector("path")?.getAttribute("d") ?? "";
    // The first dark module sits inside the quiet zone, at (4, 4).
    expect(d.startsWith("M4 4h1v1h-1z")).toBe(true);
  });
});
