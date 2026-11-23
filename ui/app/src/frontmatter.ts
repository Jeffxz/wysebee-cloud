/**
 * A markdown page's frontmatter: the `---` block at its very top holding `key: value`
 * lines (YAML, as skills and workspace pages write it), shown by the Workspaces editor's
 * Preview as a table above the page rather than as one run-on paragraph.
 *
 * Only the simple shapes pages use: `key: value` (quotes around the value dropped), a key
 * whose value is a list of `- item` lines, or wraps onto indented lines — and a list whose
 * items are themselves `key: value` lines, as a skill's `scripts:` is (each item one string,
 * `name: x · command: y`). A closed block in any other shape is given back as written
 * (`raw`), so Preview shows it as it is rather than reading it as the page's markdown.
 * No block, an unclosed one or an empty one: `null`.
 */

export interface Frontmatter {
  /** Each key with its value, or its list's items, in the order written; none when `raw`. */
  fields: [key: string, value: string | string[]][];
  /** The block's lines as written, when they are in no shape read here. */
  raw?: string;
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
  const block = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").replace(/^\n+/, "");
  const fields: Frontmatter["fields"] = [];
  // How far the last list item's `-` is indented: deeper lines belong to that item.
  let itemIndent: number | null = null;
  for (const line of block) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    const key = KEY.exec(line);
    if (key && indent === 0) {
      fields.push([key[1], unquote(key[2] ?? "")]);
      itemIndent = null;
      continue;
    }
    const last = fields[fields.length - 1];
    if (!last) return { fields: [], raw: block.join("\n"), body };
    const item = /^(\s*)-\s+(.*)$/.exec(line);
    if (item) {
      const items = Array.isArray(last[1]) ? last[1] : last[1] ? [last[1]] : [];
      last[1] = [...items, entry(item[2])];
      itemIndent = item[1].length;
    } else if (Array.isArray(last[1]) && itemIndent !== null && indent > itemIndent) {
      // The item goes on: its mapping's next key, or its text wrapping.
      const items = last[1];
      const more = KEY.exec(line.trim());
      items[items.length - 1] += more ? ` · ${entry(line.trim())}` : ` ${line.trim()}`;
    } else if (indent > 0 && !Array.isArray(last[1])) {
      last[1] = `${last[1]} ${line.trim()}`.trim();
    } else {
      return { fields: [], raw: block.join("\n"), body };
    }
  }
  if (!fields.length) return null;
  return { fields, body };
}

/** A list item as shown: `key: value` with the value's quotes dropped, else the item. */
function entry(text: string): string {
  const pair = KEY.exec(text.trim());
  if (!pair) return unquote(text);
  return pair[2] === undefined ? `${pair[1]}:` : `${pair[1]}: ${unquote(pair[2])}`;
}
