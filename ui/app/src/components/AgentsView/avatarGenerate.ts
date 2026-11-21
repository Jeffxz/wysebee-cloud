import { createAvatar, type Style } from "@dicebear/core";
import * as glass from "@dicebear/glass";
import * as lorelei from "@dicebear/lorelei";
import * as notionists from "@dicebear/notionists";
import * as openPeeps from "@dicebear/open-peeps";
import * as pixelArt from "@dicebear/pixel-art";
import * as rings from "@dicebear/rings";
import * as shapes from "@dicebear/shapes";
import * as thumbs from "@dicebear/thumbs";
import i18n from "../../i18n";

// Generated avatars for the picker (2026-11-03): DiceBear's styles drawn on this computer —
// no request to anybody, a new one for every seed. Only CC0 styles (dicebear.com/licenses),
// so nothing needs crediting. Loaded with the picker, so it is not in the app's first bundle.

/** The styles offered, in order: the key names their label (`agents.avatar.styles.<key>`). */
export const AVATAR_STYLES = [
  { key: "notionists", style: notionists },
  { key: "lorelei", style: lorelei },
  { key: "openPeeps", style: openPeeps },
  { key: "thumbs", style: thumbs },
  { key: "pixelArt", style: pixelArt },
  { key: "glass", style: glass },
  { key: "rings", style: rings },
  { key: "shapes", style: shapes },
] as const satisfies readonly { key: string; style: Style<object> }[];

export type AvatarStyleKey = (typeof AVATAR_STYLES)[number]["key"];

/** How many the picker shows at once. */
export const BATCH = 12;

/** A fresh random seed: each is a different avatar. */
export function newSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newSeeds(n = BATCH): string[] {
  return Array.from({ length: n }, newSeed);
}

function styleOf(key: AvatarStyleKey): Style<object> {
  return (AVATAR_STYLES.find((s) => s.key === key) ?? AVATAR_STYLES[0]).style;
}

/** The avatar for `seed` in `key`'s style, as an SVG data URI to show. */
export function previewUrl(key: AvatarStyleKey, seed: string): string {
  return createAvatar(styleOf(key), { seed, size: 96 }).toDataUri();
}

/**
 * The avatar as a PNG data URI to save: Wysebee Cloud keeps pictures as PNG, JPEG, WebP or
 * GIF (never SVG), and a picture shows the same in every Wysebee app — the desktop, the
 * website, the browser extension and the phone.
 */
export async function avatarPng(key: AvatarStyleKey, seed: string, size = 192): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image(size, size);
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(i18n.t("agents.avatar.readFailed")));
    el.src = createAvatar(styleOf(key), { seed, size }).toDataUri();
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(i18n.t("agents.avatar.canvasUnavailable"));
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL("image/png");
}
