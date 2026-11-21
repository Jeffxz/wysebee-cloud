import { afterEach, describe, expect, it, vi } from "vitest";

/** The language the page starts in, given the browser's preferences. */
async function startsIn(languages: string[] | undefined, language = "en-US"): Promise<string> {
  vi.stubGlobal("navigator", { ...navigator, languages, language });
  vi.resetModules();
  const { default: i18n } = await import("./index");
  expect(document.documentElement.lang).toBe(i18n.language);
  return i18n.language;
}

afterEach(() => {
  document.documentElement.lang = "";
});

describe("the page's language", () => {
  it("is the browser's first supported language", async () => {
    expect(await startsIn(["de-DE", "fr-CA", "en"])).toBe("fr");
    expect(await startsIn(["", "ja"])).toBe("ja");
    expect(await startsIn(["de", "it"])).toBe("en");
  });

  it("splits Chinese by script", async () => {
    for (const tag of ["zh-TW", "zh-HK", "zh-MO", "zh-Hant-SG"]) expect(await startsIn([tag])).toBe("zh-TW");
    for (const tag of ["zh", "zh-CN", "zh-Hans", "zh-SG"]) expect(await startsIn([tag])).toBe("zh-CN");
  });

  it("uses navigator.language when there is no list", async () => {
    expect(await startsIn(undefined, "ja-JP")).toBe("ja");
    expect(await startsIn([], "fr")).toBe("fr");
  });

  it("is English without a navigator", async () => {
    vi.stubGlobal("navigator", undefined);
    vi.resetModules();
    const { default: i18n } = await import("./index");
    expect(i18n.language).toBe("en");
  });

  it("translates, falling back to English", async () => {
    await startsIn(["fr"]);
    const { default: i18n } = await import("./index");
    expect(i18n.t("shell.headers.tasks")).not.toBe("shell.headers.tasks");
    expect(i18n.t("tasks.list.add", { lng: "en" })).toBeTruthy();
  });
});
