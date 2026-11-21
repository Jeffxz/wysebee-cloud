import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * The SPA's translations.
 *
 * **One file per area per language**, under `locales/<lang>/<area>.json`, each
 * holding a single top-level key named after its area (`{"agents": {...}}`). They
 * are found by glob and merged into one "translation" namespace, so a component
 * writes `t("agents.chat.send")` and adding an area or a language is adding files,
 * not editing this one. One area per file is also what lets the areas be written
 * (and translated) independently without colliding.
 *
 * English is the source and the fallback: a key missing in another language shows
 * the English text, never the raw key.
 *
 * Only the pages are translated. Messages the server returns (an API error's
 * `detail`) arrive in English. The language is the browser's: the first of
 * `navigator.languages` supported (Wysebee Desktop also lets the person choose).
 */

/** The languages there are translations for, by BCP 47 code, with their own names. */
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "ja", name: "日本語" },
  { code: "zh-CN", name: "简体中文" },
  { code: "zh-TW", name: "繁體中文" },
] as const;

type LanguageCode = (typeof LANGUAGES)[number]["code"];

type Tree = { [key: string]: string | Tree };

function merge(into: Tree, from: Tree): Tree {
  for (const [k, v] of Object.entries(from)) {
    const existing = into[k];
    into[k] =
      typeof v === "object" && typeof existing === "object"
        ? merge(existing, v)
        : v;
  }
  return into;
}

const files = import.meta.glob<{ default: Tree }>("./locales/*/*.json", {
  eager: true,
});
const resources: Record<string, { translation: Tree }> = {};
for (const [path, mod] of Object.entries(files)) {
  const lang = path.split("/")[2];
  resources[lang] ??= { translation: {} };
  merge(resources[lang].translation, mod.default);
}

const isSupported = (code: string): code is LanguageCode =>
  LANGUAGES.some((l) => l.code === code);

/**
 * The browser's language: the first of `navigator.languages` we support. Chinese is
 * split by script, not country — Traditional for Taiwan, Hong Kong, Macau or an explicit
 * `Hant`, Simplified for everything else.
 */
function browserLanguage(): LanguageCode {
  const preferred =
    typeof navigator !== "undefined"
      ? navigator.languages?.length
        ? navigator.languages
        : [navigator.language]
      : [];
  for (const raw of preferred) {
    const tag = (raw || "").toLowerCase();
    if (tag.startsWith("zh")) {
      return /hant|-tw|-hk|-mo/.test(tag) ? "zh-TW" : "zh-CN";
    }
    const base = tag.split("-")[0];
    if (isSupported(base)) return base;
  }
  return "en";
}

const initial = browserLanguage();
void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false, // React already escapes values.
  },
});
if (typeof document !== "undefined") document.documentElement.lang = initial;

export default i18n;
