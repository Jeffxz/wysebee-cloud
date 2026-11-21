import { describe, expect, it } from "vitest";
import platform from "./platform";
import { POLL_MS } from "./reminders";

describe("the web's stand-ins for an app shell", () => {
  it("leaves links and pictures to the page", async () => {
    expect(await platform.openExternal("https://x.io")).toBe(false);
    await expect(platform.saveBase64("a.png", "AA==")).rejects.toThrow("No shell on the web.");
    expect(POLL_MS).toBe(15_000);
  });
});
