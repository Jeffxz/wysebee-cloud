/**
 * A markdown page's frontmatter: the `---` block at its very top holding `key: value`
 * lines (YAML, as skills and workspace pages write it), shown by the Workspaces editor's
 * Preview as a table above the page rather than as one run-on paragraph.
 *
 * Only the simple shapes pages use: `key: value` (quotes around the value dropped),
 * and a key whose value is a list of `- item` lines, or wraps onto indented lines.
 * Anything else keeps the block as it was: `null`, and the page is shown as written.
 */

export interface Frontmatter {
  /** Each key with its value, or its list's items, in the order written. */
  fields: [key: string, value: string | string[]][];
  /** The page after the block. */
  body: string;
}

const KEY = /^([A-Za-z_][\w.-]*)\s*:(?:\s+(.*))?$/;

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1);
  return v;
}

export function splitFrontmatter(text: string): Frontmatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (end < 0) return null;
  const fields: Frontmatter["fields"] = [];
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const key = KEY.exec(line);
    if (key && !/^\s/.test(line)) {
      fields.push([key[1], unquote(key[2] ?? "")]);
      continue;
    }
    const last = fields[fields.length - 1];
    if (!last) return null;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item) {
      const items = Array.isArray(last[1]) ? last[1] : last[1] ? [last[1]] : [];
      last[1] = [...items, unquote(item[1])];
    } else if (/^\s/.test(line) && !Array.isArray(last[1])) {
      last[1] = `${last[1]} ${line.trim()}`.trim();
    } else {
      return null;
    }
  }
  if (!fields.length) return null;
  return { fields, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}
