/**
 * Site tools as Wysebee's settings hold them — Open Gmail, Open Calendar, Travel, News and
 * Website, each one tool over a list of links, each with what it is for (the desktop's
 * sites.rs and sites.ts): read from a config, and checked before the dialog saves them.
 * Pure, so it is tested on its own.
 */

import type { SiteKind, SiteLink } from "../../api";

const GMAIL = "https://mail.google.com/";

/** Each kind's list in Wysebee's settings. */
export const SITE_FIELDS: Record<SiteKind, string> = { gmail: "gmail_accounts", calendar: "calendar_sites", travel: "travel_sites", news: "news_sites", website: "websites" };

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Whether a link may be one of this kind's: Gmail's must be Gmail's own, any other an
 * http(s) page. */
export function isSiteLink(kind: SiteKind, link: string): boolean {
  const a = link.trim();
  if (!a || /\s/.test(a)) return false;
  if (kind === "gmail") return a.startsWith(GMAIL);
  try {
    const url = new URL(a);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** The links in a config; an entry that cannot be read is left out. */
export function sitesOf(value: unknown): SiteLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    return [{ description: str(o.description), address: str(o.address) }];
  });
}

/** What is wrong with the links about to be saved: a translation key and which link
 * (from 1), or null. */
export function siteProblemOf(kind: SiteKind, links: SiteLink[]): { key: string; n?: number } | null {
  if (links.length === 0) return { key: "agents.tools.sites.needOne" };
  for (const [i, a] of links.entries()) {
    const n = i + 1;
    if (!isSiteLink(kind, a.address)) return { key: kind === "gmail" ? "agents.tools.sites.badGmailLink" : "agents.tools.sites.badLink", n };
    if (links.slice(0, i).some((o) => o.address.trim() === a.address.trim())) return { key: "agents.tools.sites.twice", n };
    if (!a.description.trim() || a.description.length > 1000) return { key: "agents.tools.sites.needDescription", n };
  }
  return null;
}

export const MAX_SITES = 20;
