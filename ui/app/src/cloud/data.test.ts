import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ accessToken: async () => "t", reauthenticate: async () => {} }));

import { assetDataUrl, cloudFetch } from "./data";
import { SUBSCRIPTION_REQUIRED } from "./paywall";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Bytes and a Content-Type header, as the asset route answers: no Blob, whose kind differs
// between Node versions under jsdom.
const serve = (bytes: Uint8Array<ArrayBuffer>, type?: string) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, type ? { headers: { "Content-Type": type } } : {})));

describe("assetDataUrl", () => {
  it("encodes a picture with its type", async () => {
    serve(new TextEncoder().encode("PNG!"), "image/png");
    await expect(assetDataUrl("a1")).resolves.toBe("data:image/png;base64,UE5HIQ==");
  });

  it("names a picture of no type as plain bytes", async () => {
    serve(new Uint8Array([1, 2, 3]));
    await expect(assetDataUrl("a1")).resolves.toBe("data:application/octet-stream;base64,AQID");
  });

  it("encodes a picture larger than one chunk byte for byte", async () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => (i * 7) % 256);
    serve(bytes, "image/jpeg");
    const url = (await assetDataUrl("big")) as string;
    const back = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(back).toEqual(bytes);
  });

  it("is null when the picture cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "no" }), { status: 404 })));
    await expect(assetDataUrl("gone")).resolves.toBeNull();
  });
});

describe("a refusal for want of a plan", () => {
  it("is announced, so the plan gate shows Billing; other refusals are not", async () => {
    const heard = vi.fn();
    window.addEventListener(SUBSCRIPTION_REQUIRED, heard);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Choose a plan.", code: "subscription_required" }), { status: 402 })));
      await expect(cloudFetch("/api/v1/agents")).rejects.toMatchObject({ status: 402, code: "subscription_required", message: "Choose a plan." });
      expect(heard).toHaveBeenCalledTimes(1);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Over this month's relay traffic.", code: "relay_limit" }), { status: 402 })));
      await expect(cloudFetch("/api/v1/agent-links/x/calls", { method: "POST", body: "{}" })).rejects.toMatchObject({ code: "relay_limit" });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(SUBSCRIPTION_REQUIRED, heard);
    }
  });
});
