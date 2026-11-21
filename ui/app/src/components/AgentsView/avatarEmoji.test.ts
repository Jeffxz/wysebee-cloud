import { expect, it } from "vitest";
import { AVATAR_EMOJI } from "./avatarEmoji";

it("offers six rows of eight distinct emoji", () => {
  expect(AVATAR_EMOJI).toHaveLength(48);
  expect(new Set(AVATAR_EMOJI).size).toBe(48);
});
