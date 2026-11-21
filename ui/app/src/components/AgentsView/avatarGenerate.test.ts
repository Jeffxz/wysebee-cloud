import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { AVATAR_STYLES, BATCH, avatarPng, newSeeds, previewUrl } from "./avatarGenerate";

/** jsdom loads no image: one that loads (or fails) as soon as it is given a source. */
function stubImage(fails = false) {
  vi.stubGlobal(
    "Image",
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => (fails ? this.onerror?.() : this.onload?.()));
      }
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("avatarGenerate", () => {
  it("draws a different avatar for each seed, in every style", () => {
    const seeds = newSeeds();
    expect(seeds).toHaveLength(BATCH);
    expect(new Set(seeds).size).toBe(BATCH);
    for (const { key } of AVATAR_STYLES) {
      const a = previewUrl(key, "one");
      expect(a.startsWith("data:image/svg+xml")).toBe(true);
      expect(previewUrl(key, "one")).toBe(a);
      expect(previewUrl(key, "two")).not.toBe(a);
    }
    // An unknown style is the first one.
    expect(previewUrl("nope" as never, "one")).toBe(previewUrl("notionists", "one"));
  });

  it("saves it as a PNG", async () => {
    stubImage();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,AA");
    expect(await avatarPng("thumbs", "s")).toBe("data:image/png;base64,AA");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 192, 192);
    // No canvas here: said so.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(avatarPng("thumbs", "s")).rejects.toThrow();
    // A picture that does not load: said so.
    stubImage(true);
    await expect(avatarPng("thumbs", "s")).rejects.toThrow();
  });
});
