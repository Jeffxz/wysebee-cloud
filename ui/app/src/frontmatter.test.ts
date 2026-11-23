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

  it("reads a list of key: value items, as a skill's scripts are, each item one line", () => {
    const page = [
      "---",
      "name: report",
      "scripts:",
      "  - name: hello",
      "    command: python3 scripts/hello.py",
      "    description: 'Says hello'",
      "      and waves",
      "  - name: bye",
      "    command: ./bye.sh",
      "    args:",
      "after: x",
      "---",
      "# Report",
    ].join("\n");
    expect(splitFrontmatter(page)).toEqual({
      fields: [
        ["name", "report"],
        ["scripts", ["name: hello · command: python3 scripts/hello.py · description: Says hello and waves", "name: bye · command: ./bye.sh · args:"]],
        ["after", "x"],
      ],
      body: "# Report",
    });
  });

  it("gives a closed block it cannot read back as written, never as the page", () => {
    for (const block of ["  orphan", "k:\n  - a\n  wrapped", "not a field"]) {
      expect(splitFrontmatter(`---\n${block}\n---\n\nBody`)).toEqual({ fields: [], raw: block, body: "Body" });
    }
  });

  it("leaves a page with no block, an unclosed one, or an empty one as it is", () => {
    for (const page of ["# Title\n---\nname: x\n---", "---\nname: x\n", "---\n---\nBody", "---\n# only a note\n---\n", ""]) {
      expect(splitFrontmatter(page)).toBeNull();
    }
  });
});
