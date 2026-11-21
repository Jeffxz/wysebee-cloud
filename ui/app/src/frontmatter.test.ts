import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("reads key: value lines, drops quotes, and gives the page after the block", () => {
    const page = '---\nname: Wysebee Platform\ndescription: "High-level: what and why"\ncreator: \'Kim Lee\'\n---\n\n# Title\n';
    expect(splitFrontmatter(page)).toEqual({
      fields: [
        ["name", "Wysebee Platform"],
        ["description", "High-level: what and why"],
        ["creator", "Kim Lee"],
      ],
      body: "# Title\n",
    });
  });

  it("reads lists and wrapped values, skips blanks and comments, and takes CRLF and '...'", () => {
    const page = "---\r\ntags:\r\n  - cloud\r\n  - 'desktop'\r\n# a note\r\n\r\nsummary: one\r\n  two\r\nempty:\r\n...\r\nBody";
    expect(splitFrontmatter(page)).toEqual({
      fields: [
        ["tags", ["cloud", "desktop"]],
        ["summary", "one two"],
        ["empty", ""],
      ],
      body: "Body",
    });
    // A list after a value keeps the value as its first item.
    expect(splitFrontmatter("---\nk: a\n- b\n---\n")?.fields).toEqual([["k", ["a", "b"]]]);
  });

  it("leaves a page with no block, an unclosed one, or one it cannot read as it is", () => {
    for (const page of [
      "# Title\n---\nname: x\n---",
      "---\nname: x\n",
      "---\n---\nBody",
      "---\n  orphan\n---\n",
      "---\nk:\n  - a\n  wrapped\n---\n",
      "---\nnot a field\n---\n",
      "",
    ]) {
      expect(splitFrontmatter(page)).toBeNull();
    }
  });
});
