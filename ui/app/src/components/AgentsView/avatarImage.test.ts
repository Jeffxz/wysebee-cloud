import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { downscaleImageToDataUrl } from "./avatarImage";

class FakeImage {
  static fail = false;
  width = 200;
  height = 100;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
  }
}

describe("downscaleImageToDataUrl", () => {
  let revoke: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    FakeImage.fail = false;
    vi.stubGlobal("Image", FakeImage);
    revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cover-fits into a square JPEG", async () => {
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg;base64,AA");
    const out = await downscaleImageToDataUrl(new File(["x"], "a.png"));
    expect(out).toBe("data:image/jpeg;base64,AA");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), -48, 0, 192, 96);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });

  it("fails when the image cannot be read", async () => {
    FakeImage.fail = true;
    await expect(downscaleImageToDataUrl(new File(["x"], "a.png"))).rejects.toThrow(/read/i);
    expect(revoke).toHaveBeenCalled();
  });

  it("fails without a canvas", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    await expect(downscaleImageToDataUrl(new File(["x"], "a.png"), 10, 0.5)).rejects.toThrow();
  });
});
