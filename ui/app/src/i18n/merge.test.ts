import { describe, expect, it, vi } from "vitest";

// Two files of one language naming the same area are merged key by key, not replaced.
// No shipped pair does (one area per file), so one is stood in for here.
vi.mock("./locales/en/common.json", async (importOriginal) => {
  const real = (await importOriginal<{ default: Record<string, unknown> }>()).default;
  return { default: { ...real, agents: { mergeTestOnly: "merged" } } };
});

describe("locale files sharing an area", () => {
  it("keep both files' keys", async () => {
    const { default: i18n } = await import("./index");
    expect(i18n.t("agents.mergeTestOnly")).toBe("merged");
    expect(i18n.t("agents.general.label")).not.toBe("agents.general.label");
  });
});
