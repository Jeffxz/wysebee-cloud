// Checks every translation of the web app (/app/) against English: same keys (allowing
// each language's own plural forms), the same {{placeholders}}, the same <tags>, the same
// literal {single-brace} tokens, and valid JSON. Run: yarn check:locales
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, "../app/src/i18n/locales");
const app = "app";
const PLURAL = /_(zero|one|two|few|many|other)$/;
// Plural categories per language (CLDR, as Intl.PluralRules reports them).
const categories = (lang) => new Intl.PluralRules(lang).resolvedOptions().pluralCategories;

function leaves(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") leaves(v, key, out);
    else out[key] = String(v);
  }
  return out;
}
const tokens = (s, re) => [...s.matchAll(re)].map((m) => m[0]).sort().join("|");
const PLACEHOLDER = /\{\{\s*[\w.]+(?:\s*,[^}]*)?\s*\}\}/g;
const TAG = /<\/?[a-zA-Z][\w]*\s*\/?>/g;
const SINGLE = /(?<!\{)\{[a-zA-Z_][\w-]*\}(?!\})/g;

let problems = 0;
const report = (msg) => {
  problems++;
  console.log(msg);
};
const en = {};
for (const f of fs.readdirSync(path.join(root, "en"))) {
  en[f] = leaves(JSON.parse(fs.readFileSync(path.join(root, "en", f), "utf8")));
}
const langs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(root).filter((l) => l !== "en");
for (const lang of langs) {
  const cats = categories(lang);
  for (const [file, enLeaves] of Object.entries(en)) {
    const p = path.join(root, lang, file);
    if (!fs.existsSync(p)) {
      report(`${app}/${lang}/${file}: missing file`);
      continue;
    }
    let tr;
    try {
      tr = leaves(JSON.parse(fs.readFileSync(p, "utf8")));
    } catch (e) {
      report(`${app}/${lang}/${file}: invalid JSON (${e.message})`);
      continue;
    }
    // Expected keys: non-plural English keys as-is; plural English bases expanded
    // to this language's categories.
    const expected = new Set();
    const bases = new Map();
    for (const k of Object.keys(enLeaves)) {
      const m = k.match(PLURAL);
      if (m) {
        const base = k.slice(0, -m[0].length);
        bases.set(base, enLeaves[`${base}_other`] ?? enLeaves[k]);
      } else expected.add(k);
    }
    for (const base of bases.keys()) for (const c of cats) expected.add(`${base}_${c}`);
    for (const k of expected) if (!(k in tr)) report(`${app}/${lang}/${file}: missing ${k}`);
    for (const k of Object.keys(tr)) if (!expected.has(k)) report(`${app}/${lang}/${file}: unexpected ${k}`);
    for (const [k, v] of Object.entries(tr)) {
      const m = k.match(PLURAL);
      const source = m ? bases.get(k.slice(0, -m[0].length)) : enLeaves[k];
      if (source === undefined) continue;
      if (!v.trim() && source.trim()) report(`${app}/${lang}/${file}: empty ${k}`);
      // {{count}} may be dropped in a singular form ("one item"); everything else must match.
      const ph = (s) => tokens(s, PLACEHOLDER).split("|").filter((t) => !(m && t.includes("count"))).join("|");
      if (ph(v) !== ph(source)) report(`${app}/${lang}/${file}: placeholders differ in ${k}`);
      if (tokens(v, TAG) !== tokens(source, TAG)) report(`${app}/${lang}/${file}: tags differ in ${k}`);
      if (tokens(v, SINGLE) !== tokens(source, SINGLE)) report(`${app}/${lang}/${file}: literal {tokens} differ in ${k}`);
    }
  }
}
console.log(problems ? `${problems} problem(s)` : "all locales OK");
process.exit(problems ? 1 : 0);
