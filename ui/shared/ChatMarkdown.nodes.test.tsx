import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "../app/src/i18n";

// The hast nodes react-markdown hands `pre`, crafted: shapes real markdown never makes
// (a missing node, a code element with no class or no children, odd children).
const NODES: unknown[] = [
  undefined,
  {},
  { children: [{ tagName: "p" }] },
  { children: [{ tagName: "code" }] },
  { children: [{ tagName: "code", properties: { className: "language-d3" } }] },
  {
    children: [
      {
        tagName: "code",
        properties: { className: ["language-d3"] },
        children: [null, 7, { type: "text" }, { type: "element" }, { type: "element", children: [{ type: "text", value: "deep\n" }] }],
      },
    ],
  },
  { children: [{ tagName: "code", properties: { className: ["language-calendar"] }, children: [] }] },
];

vi.mock("react-markdown", () => ({
  default: ({ components }: { components: Record<string, (p: { node?: unknown; href?: string; children?: ReactNode }) => ReactNode> }) => (
    <div>
      {components.a({ href: undefined, children: "no href" })}
      {NODES.map((node, i) => (
        <div key={i} data-testid={`n${i}`}>
          {components.pre({ node, children: `raw${i}` })}
        </div>
      ))}
    </div>
  ),
}));

const { ChatMarkdown } = await import("./ChatMarkdown");

describe("ChatMarkdown's block detection", () => {
  it("draws only a code element with a known language, and reads its text", () => {
    render(
      <ChatMarkdown
        text="ignored"
        link={(href, children) => <span data-testid="a">{`${href ?? "none"}:${String(children)}`}</span>}
        blocks={{ d3: (code) => <b data-testid="d3">[{code}]</b>, calendar: undefined }}
      />,
    );
    expect(screen.getByTestId("a").textContent).toBe("none:no href");
    for (const i of [0, 1, 2, 3, 4, 6]) expect(screen.getByTestId(`n${i}`).textContent).toBe(`raw${i}`);
    expect(screen.getByTestId("d3").textContent).toBe("[deep]");
  });
});
