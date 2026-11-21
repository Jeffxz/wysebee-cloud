import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "../app/src/i18n";
import { EmailList, parseEmails } from "./EmailList";

const labels = {
  count: (n: number) => `${n} emails`,
  openOriginal: "Open the original email",
  noSubject: "(no subject)",
  noBody: "(no body)",
  unread: "Unread",
  invalid: (e: string) => `Invalid: ${e}`,
};
const link = (href: string, children: ReactNode) => <a href={href}>{children}</a>;
const body = (text: string) => <div data-testid="body">{text}</div>;

describe("parseEmails", () => {
  it("reads the object or the bare array, keeping only what it understands", () => {
    expect(parseEmails('{"title": "Inbox", "emails": [{"subject": "Hi", "date": 5, "unread": true}, null, 3]}')).toEqual({
      title: "Inbox",
      emails: [
        { subject: "Hi", from: undefined, date: "5", snippet: undefined, body: undefined, url: undefined, unread: true },
      ],
    });
    expect(parseEmails('[{"subject": "  "}]')).toEqual({
      title: undefined,
      emails: [{ subject: "", from: undefined, date: undefined, snippet: undefined, body: undefined, url: undefined, unread: false }],
    });
    expect(parseEmails('{"emails": []}')).toEqual({ title: undefined, emails: [] });
  });

  it("says why it could not", () => {
    expect(parseEmails("{")).toHaveProperty("error");
    expect(parseEmails("null")).toEqual({ error: "expected a list of emails" });
    expect(parseEmails('{"emails": 1}')).toEqual({ error: "expected a list of emails" });
    vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "odd";
    });
    expect(parseEmails("[]")).toEqual({ error: "odd" });
  });
});

describe("EmailList", () => {
  it("shows the text and why when it is not a list", () => {
    render(<EmailList text="nope" labels={labels} link={link} body={body} />);
    expect(screen.getByText(/^Invalid:/)).toBeTruthy();
    expect(screen.getByText("nope")).toBeTruthy();
  });

  it("lists subjects and opens one at a time", async () => {
    const text = JSON.stringify([
      { subject: "Invoice", from: "Ann", date: "Mon", snippet: "Pay me", body: "Full **body**", url: "https://mail/1", unread: true },
      { subject: "", snippet: "Only a snippet", url: "javascript:alert(1)" },
      { subject: "Bare", from: "Bob" },
      { subject: "Nothing" },
    ]);
    const { container } = render(<EmailList text={text} labels={labels} link={link} body={body} />);
    expect(screen.getByText("4 emails")).toBeTruthy();
    expect(screen.getByLabelText("Unread")).toBeTruthy();
    expect(screen.getByText("(no subject)")).toBeTruthy();
    expect(container.textContent).toContain("Ann — Pay me");
    expect(container.textContent).toContain("Only a snippet");

    const [first, second, third, fourth] = screen.getAllByRole("button");
    await userEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("body").textContent).toBe("Full **body**");
    expect(screen.getByText("Open the original email").getAttribute("href")).toBe("https://mail/1");
    // Opened, the snippet leaves the summary line.
    expect(container.textContent).not.toContain("Ann — Pay me");

    await userEvent.click(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("body")).toBeNull();
    // No body: the snippet stands in. Not http(s): no link.
    expect(screen.getByText("Only a snippet").className).toContain("italic");
    expect(screen.queryByText("Open the original email")).toBeNull();

    await userEvent.click(third);
    expect(screen.getByText("(no body)")).toBeTruthy();
    await userEvent.click(third);
    expect(screen.queryByText("(no body)")).toBeNull();
    await userEvent.click(fourth);
    expect(screen.getByText("(no body)")).toBeTruthy();
  });

  it("uses the block's title", () => {
    render(<EmailList text='{"title": "Unread mail", "emails": []}' labels={labels} link={link} body={body} />);
    expect(screen.getByText("Unread mail")).toBeTruthy();
  });
});
