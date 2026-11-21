import { useMemo, useState, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * An agent's ```email-list block: the emails it read in the browser (a webmail page),
 * as a list a person can open one by one.
 *
 * The block is JSON — `{"title"?, "emails": [...]}` or the array alone — each email
 * `{subject, from?, date?, snippet?, body?, url?, unread?}`; ui/shared and
 * chat/loop.OUTPUT_GUIDE describe the same shape, change one, change both. Everything in
 * it came from somebody's mailbox, so it is shown as text and markdown only (no HTML,
 * no charts) and a link opens only if it is http(s).
 */
export interface Email {
  subject: string;
  from?: string;
  date?: string;
  snippet?: string;
  body?: string;
  url?: string;
  unread?: boolean;
}

export interface EmailLabels {
  /** "{count} emails", when the block gives no title. */
  count: (n: number) => string;
  openOriginal: string;
  noSubject: string;
  /** Shown when an opened email has no body in the block. */
  noBody: string;
  unread: string;
  /** "The email list could not be read: {error}" — the caller formats it. */
  invalid: (error: string) => string;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : undefined;

/** The block's JSON as emails, or the reason it is not. */
export function parseEmails(text: string): { title?: string; emails: Email[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const list = Array.isArray(data) ? data : (data as { emails?: unknown } | null)?.emails;
  if (!Array.isArray(list)) return { error: "expected a list of emails" };
  const emails = list
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => ({
      subject: str(e.subject) ?? "",
      from: str(e.from),
      date: str(e.date),
      snippet: str(e.snippet),
      body: str(e.body),
      url: str(e.url),
      unread: e.unread === true,
    }));
  const title = Array.isArray(data) ? undefined : str((data as { title?: unknown }).title);
  return { title, emails };
}

export function EmailList({
  text,
  labels,
  link,
  body,
}: {
  text: string;
  labels: EmailLabels;
  /** How a link opens — each app has its own way out. Given only http(s) urls. */
  link: (href: string, children: ReactNode) => ReactNode;
  /** How an opened email's body is shown (markdown, without charts). */
  body: (text: string) => ReactNode;
}) {
  const parsed = useMemo(() => parseEmails(text), [text]);
  const [open, setOpen] = useState<number | null>(null);

  if ("error" in parsed) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-amber-700 dark:text-amber-400">{labels.invalid(parsed.error)}</span>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{text}</pre>
      </div>
    );
  }
  const { emails } = parsed;
  return (
    // The person's own mail: no subject or sender may leave in a click's label.
    <div className="overflow-hidden rounded-md border border-stone-200 dark:border-stone-700" data-track-private>
      <div className="border-b border-stone-200 bg-stone-50 px-2.5 py-1.5 text-xs font-semibold dark:border-stone-700 dark:bg-stone-900/40">
        {parsed.title ?? labels.count(emails.length)}
      </div>
      {/* Important: the chat bubble styles every ul/li inside it as a bulleted list. */}
      <ul className="!my-0 !list-none !pl-0 divide-y divide-stone-200 dark:divide-stone-700">
        {emails.map((email, i) => {
          const expanded = open === i;
          const url = email.url && /^https?:\/\//i.test(email.url) ? email.url : undefined;
          return (
            <li key={i} className={cn("!my-0", expanded && "bg-stone-50 dark:bg-stone-900/30")}>
              <button
                type="button"
                className="flex w-full flex-col items-stretch gap-0.5 px-2.5 py-1.5 text-left hover:bg-stone-50 dark:hover:bg-stone-900/40"
                onClick={() => setOpen(expanded ? null : i)}
                aria-expanded={expanded}
              >
                <span className="flex items-baseline gap-2">
                  {email.unread && (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary-600"
                      title={labels.unread}
                      aria-label={labels.unread}
                    />
                  )}
                  <span className={cn("min-w-0 flex-1 truncate text-sm", email.unread && "font-semibold")}>
                    {email.subject || labels.noSubject}
                  </span>
                  {email.date && (
                    <span className="shrink-0 text-[11px] text-stone-500 dark:text-stone-400">{email.date}</span>
                  )}
                </span>
                {(email.from || (!expanded && email.snippet)) && (
                  <span className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {email.from}
                    {email.from && !expanded && email.snippet ? " — " : ""}
                    {!expanded && email.snippet}
                  </span>
                )}
              </button>
              {expanded && (
                <div className="flex flex-col gap-2 px-2.5 pb-2.5">
                  <div className="max-h-96 overflow-auto rounded border border-stone-200 bg-white px-2.5 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-800">
                    {email.body ? body(email.body) : (
                      <span className="text-xs italic text-stone-500 dark:text-stone-400">
                        {email.snippet ?? labels.noBody}
                      </span>
                    )}
                  </div>
                  {url && <div className="text-xs">{link(url, labels.openOriginal)}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
