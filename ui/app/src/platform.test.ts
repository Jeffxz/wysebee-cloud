import { describe, expect, it } from "vitest";
import platform from "./platform";
import { POLL_MS } from "./reminders";

describe("the web's stand-ins for an app shell", () => {
  it("leaves links to the page", async () => {
    expect(await platform.openExternal("https://x.io")).toBe(false);
    expect(POLL_MS).toBe(15_000);
  });
});
