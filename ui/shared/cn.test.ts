import { describe, expect, it } from "vitest";
import { btn, cn } from "./cn";

describe("cn", () => {
  it("joins conditional classes and lets the later Tailwind utility win", () => {
    expect(cn("px-2", false && "hidden", "px-4", ["text-sm"])).toBe("px-4 text-sm");
    expect(btn).toContain("inline-flex");
  });
});
