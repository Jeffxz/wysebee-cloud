import { describe, expect, it } from "vitest";
import { intentOf } from "./auth";

describe("intentOf", () => {
  it("is a sign-up for ?signup or ?screen_hint=signup, else a sign-in", () => {
    expect(intentOf("")).toBe("sign_in");
    expect(intentOf("?signup")).toBe("sign_up");
    expect(intentOf("?screen_hint=signup")).toBe("sign_up");
    expect(intentOf("?screen_hint=login")).toBe("sign_in");
  });
});
