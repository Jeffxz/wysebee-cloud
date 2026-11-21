import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import "../app/src/i18n";
import { ChatMarkdown, MARKDOWN_CLASSES } from "./ChatMarkdown";

const link = (href: string | undefined, children: ReactNode) => (
  <a data-testid="link" data-href={href}>
    {children}
  </a>
);

describe("ChatMarkdown", () => {
  it("renders GitHub-flavoured markdown, links through the app's own way out", () => {
    const { container } = render(
      <ChatMarkdown text={"**bold** ~~gone~~ [site](https://a.example)\n\n| a |\n|---|\n| 1 |\n\n```js\nx()\n```"} link={link} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("del")).toBeTruthy();
    expect(container.querySelector("table")).toBeTruthy();
    expect(screen.getByTestId("link").getAttribute("data-href")).toBe("https://a.example");
    expect(container.querySelector("pre code")?.textContent).toBe("x()\n");
    expect(MARKDOWN_CLASSES).toContain("[&_pre]");
  });

  it("draws the blocks it is given a renderer for and shows the rest as code", () => {
    const text = [
      "```d3\nchart()\n```",
      "```email-list\n[]\n```",
      "```calendar\n{}\n```",
      "```\nplain\n```",
    ].join("\n\n");
    const { container } = render(
      <ChatMarkdown
        text={text}
        link={link}
        blocks={{
          d3: (code) => <div data-testid="chart">{code}</div>,
          "email-list": (json) => <div data-testid="emails">{json}</div>,
        }}
      />,
    );
    expect(screen.getByTestId("chart").textContent).toBe("chart()");
    expect(screen.getByTestId("emails").textContent).toBe("[]");
    const pres = [...container.querySelectorAll("pre")].map((p) => p.textContent);
    expect(pres).toEqual(["{}\n", "plain\n"]);
  });
});
