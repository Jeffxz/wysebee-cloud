import { describe, expect, it } from "vitest";
import { isSiteLink, siteProblemOf, sitesOf } from "./sites";

describe("sites", () => {
  it("takes Gmail's own links for Gmail, any web page for the rest", () => {
    expect(isSiteLink("gmail", " https://mail.google.com/mail/u/1/#inbox ")).toBe(true);
    for (const bad of ["", "me@corp.com", "https://evil.example/", "https://mail.google.com/a b"]) expect(isSiteLink("gmail", bad)).toBe(false);
    expect(isSiteLink("news", "https://www.bbc.com/news")).toBe(true);
    expect(isSiteLink("website", "http://example.com")).toBe(true);
    for (const bad of ["bbc.com", "ftp://x.com/", "javascript:alert(1)", "https://"]) expect(isSiteLink("news", bad)).toBe(false);
  });

  it("reads the links in a config, dropping an old name", () => {
    expect(sitesOf([{ name: "w", description: "d", address: "a@b.co" }, 3, { name: 1 }])).toEqual([
      { description: "d", address: "a@b.co" },
      { description: "", address: "" },
    ]);
    expect(sitesOf("x")).toEqual([]);
  });

  it("checks every link, saying which is wrong", () => {
    const work = { description: "Work", address: "https://mail.google.com/mail/u/0/" };
    const home = { description: "Home", address: "https://mail.google.com/mail/u/1/" };
    expect(siteProblemOf("gmail", [work, home])).toBeNull();
    expect(siteProblemOf("gmail", [])).toEqual({ key: "agents.tools.sites.needOne" });
    expect(siteProblemOf("gmail", [work, { ...home, address: "me@corp.com" }])).toEqual({ key: "agents.tools.sites.badGmailLink", n: 2 });
    expect(siteProblemOf("travel", [{ ...home, address: "nope" }])).toEqual({ key: "agents.tools.sites.badLink", n: 1 });
    expect(siteProblemOf("gmail", [work, { ...home, address: work.address }])).toEqual({ key: "agents.tools.sites.twice", n: 2 });
    expect(siteProblemOf("gmail", [{ ...work, description: " " }])).toEqual({ key: "agents.tools.sites.needDescription", n: 1 });
  });
});

describe("sites on the web", () => {
  it("names each kind's list", async () => {
    const { SITE_FIELDS } = await import("./sites");
    expect(SITE_FIELDS).toEqual({ gmail: "gmail_accounts", calendar: "calendar_sites", travel: "travel_sites", news: "news_sites", website: "websites" });
  });
});
