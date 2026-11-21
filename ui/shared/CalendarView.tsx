import { useMemo, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * An agent's ```calendar block: the events it read in the browser (a web calendar),
 * drawn as a week or a day. **Read-only on
 * purpose**: it shows exactly the days the agent was asked about — there is no next or
 * previous, since nothing here could fetch another week — and links to the calendar
 * itself for anything more.
 *
 * The block is JSON: `{"title"?, "start": "YYYY-MM-DD", "days"?: 1–7, "url"?,
 * "events": [{title, start, end?, allDay?, location?, url?}]}`. Times are the calendar's
 * own wall-clock times, `YYYY-MM-DDTHH:MM` (one with an offset or `Z` is converted to this
 * computer's time). chat/loop.OUTPUT_GUIDE describes the same shape; change one, change
 * both. It came from somebody's calendar, so it is text only and links open only if http(s).
 */
export interface CalendarEvent {
  title: string;
  /** Minutes from the first shown day's midnight. */
  from: number;
  to: number;
  allDay: boolean;
  location?: string;
  url?: string;
}

export interface CalendarLabels {
  /** BCP 47 language for day and time names. */
  locale: string;
  allDay: string;
  openCalendar: string;
  noEvents: string;
  noTitle: string;
  /** "The calendar could not be read: {error}" — the caller formats it. */
  invalid: (error: string) => string;
}

const DAY = 24 * 60;
const HOUR_PX = 36;
const MAX_DAYS = 7;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const httpUrl = (v: unknown) => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : undefined;
};

/** A date or date-time as a local Date: wall-clock when it has no offset, converted when it has. */
function toDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(value);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole-minute distance from `base`, across a DST change the way a clock reads it. */
function minutesFrom(base: Date, d: Date): number {
  const days = Math.round((midnight(d).getTime() - base.getTime()) / 86_400_000);
  return days * DAY + d.getHours() * 60 + d.getMinutes();
}

/** The block's JSON as days and events, or the reason it is not. */
export function parseCalendar(
  text: string,
): { title?: string; start: Date; days: number; url?: string; events: CalendarEvent[] } | { error: string } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "expected an object" };
  const first = str(data.start) && toDate(str(data.start)!);
  if (!first) return { error: "expected a start date, YYYY-MM-DD" };
  const start = midnight(first);
  const asked = Number(data.days ?? MAX_DAYS);
  const days = Number.isFinite(asked) ? Math.min(Math.max(Math.round(asked), 1), MAX_DAYS) : MAX_DAYS;
  const events: CalendarEvent[] = [];
  for (const raw of Array.isArray(data.events) ? data.events : []) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const s = str(e.start) && toDate(str(e.start)!);
    if (!s) continue;
    const allDay = e.allDay === true || /^\d{4}-\d{2}-\d{2}$/.test(str(e.start)!);
    const endRaw = str(e.end) && toDate(str(e.end)!);
    let from = minutesFrom(start, s);
    let to = endRaw ? minutesFrom(start, endRaw) : from + (allDay ? DAY : 60);
    if (allDay) {
      from = Math.floor(from / DAY) * DAY;
      // An all-day end is exclusive when it is a bare date (iCalendar's way) — and a
      // bare date equal to the start means the one day.
      to = Math.max(Math.ceil(to / DAY) * DAY, from + DAY);
    }
    if (to <= from) to = from + 30;
    if (to <= 0 || from >= days * DAY) continue; // outside the days shown
    events.push({
      title: str(e.title) ?? "",
      from,
      to,
      allDay,
      location: str(e.location),
      url: httpUrl(e.url),
    });
  }
  return { title: str(data.title), start, days, url: httpUrl(data.url), events };
}

/** Each timed event's lane among the ones it overlaps, and how many lanes its group has. */
function lanes(events: CalendarEvent[]): Map<CalendarEvent, { lane: number; of: number }> {
  const out = new Map<CalendarEvent, { lane: number; of: number }>();
  const sorted = [...events].sort((a, b) => a.from - b.from || b.to - a.to);
  let group: CalendarEvent[] = [];
  let groupEnd = -Infinity;
  let ends: number[] = [];
  const close = () => {
    for (const e of group) out.get(e)!.of = ends.length;
    group = [];
    ends = [];
  };
  for (const e of sorted) {
    if (e.from >= groupEnd) close();
    let lane = ends.findIndex((end) => end <= e.from);
    if (lane < 0) lane = ends.push(0) - 1;
    ends[lane] = e.to;
    out.set(e, { lane, of: 0 });
    group.push(e);
    groupEnd = Math.max(groupEnd, e.to);
  }
  close();
  return out;
}

export function CalendarView({
  text,
  labels,
  link,
}: {
  text: string;
  labels: CalendarLabels;
  /** How a link opens — each app has its own way out. Given only http(s) urls. */
  link: (href: string, children: ReactNode) => ReactNode;
}) {
  const parsed = useMemo(() => parseCalendar(text), [text]);
  if ("error" in parsed) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-amber-700 dark:text-amber-400">{labels.invalid(parsed.error)}</span>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{text}</pre>
      </div>
    );
  }
  return <Grid calendar={parsed} labels={labels} link={link} />;
}

function Grid({
  calendar,
  labels,
  link,
}: {
  calendar: Exclude<ReturnType<typeof parseCalendar>, { error: string }>;
  labels: CalendarLabels;
  link: (href: string, children: ReactNode) => ReactNode;
}) {
  const { start, days, events } = calendar;
  const dates = Array.from({ length: days }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const dayName = new Intl.DateTimeFormat(labels.locale, { weekday: "short" });
  const dayNum = new Intl.DateTimeFormat(labels.locale, { month: "numeric", day: "numeric" });
  const time = new Intl.DateTimeFormat(labels.locale, { hour: "numeric", minute: "2-digit" });
  const hourName = new Intl.DateTimeFormat(labels.locale, { hour: "numeric" });
  const today = minutesFrom(start, new Date());
  const todayIndex = today >= 0 && today < days * DAY ? Math.floor(today / DAY) : -1;

  // Timed events split at midnight, so each piece belongs to one column.
  const pieces: (CalendarEvent & { day: number; whole: CalendarEvent })[] = [];
  for (const e of events.filter((e) => !e.allDay)) {
    for (let d = Math.max(0, Math.floor(e.from / DAY)); d < Math.min(days, Math.ceil(e.to / DAY)); d++) {
      pieces.push({ ...e, whole: e, day: d, from: Math.max(e.from, d * DAY) - d * DAY, to: Math.min(e.to, (d + 1) * DAY) - d * DAY });
    }
  }
  const allDay = events.filter((e) => e.allDay);
  // Office hours unless an event reaches outside them.
  const first = Math.min(8, ...pieces.map((p) => Math.floor(p.from / 60)));
  const last = Math.max(18, ...pieces.map((p) => Math.ceil(p.to / 60)));
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const at = (minutes: number) => ((minutes - first * 60) / 60) * HOUR_PX;
  const clock = (minutes: number) => time.format(new Date(2000, 0, 1, Math.floor(minutes / 60) % 24, minutes % 60));
  const describe = (e: CalendarEvent) =>
    [e.title || labels.noTitle, e.allDay ? labels.allDay : `${clock(e.from % DAY)}–${clock(e.to % DAY || 0)}`, e.location]
      .filter(Boolean)
      .join(" · ");
  const name = (e: CalendarEvent) =>
    e.url ? link(e.url, e.title || labels.noTitle) : e.title || labels.noTitle;
  const columns = { gridTemplateColumns: `3rem repeat(${days}, minmax(0, 1fr))` };

  return (
    // The person's own calendar: no event's name may leave in a click's label.
    <div className="overflow-hidden rounded-md border border-stone-200 text-xs dark:border-stone-700" data-track-private>
      {calendar.title && (
        <div className="border-b border-stone-200 bg-stone-50 px-2.5 py-1.5 font-semibold dark:border-stone-700 dark:bg-stone-900/40">
          {calendar.title}
        </div>
      )}
      <div className="overflow-x-auto">
        <div style={{ minWidth: days > 3 ? 520 : undefined }}>
          {/* day headings */}
          <div className="grid border-b border-stone-200 dark:border-stone-700" style={columns}>
            <div />
            {dates.map((d, i) => (
              <div
                key={i}
                className={cn(
                  "border-l border-stone-200 px-1 py-1 text-center dark:border-stone-700",
                  i === todayIndex && "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
                )}
              >
                <div>{dayName.format(d)}</div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400">{dayNum.format(d)}</div>
              </div>
            ))}
          </div>
          {/* all-day row */}
          {allDay.length > 0 && (
            <div className="grid border-b border-stone-200 dark:border-stone-700" style={columns}>
              <div className="px-1 py-1 text-right text-[10px] text-stone-500 dark:text-stone-400">{labels.allDay}</div>
              <div className="relative flex flex-col gap-0.5 py-0.5" style={{ gridColumn: `2 / span ${days}` }}>
                {allDay.map((e, i) => {
                  const from = Math.max(0, Math.floor(e.from / DAY));
                  const to = Math.min(days, Math.ceil(e.to / DAY));
                  return (
                    <div
                      key={i}
                      className="truncate rounded bg-primary-600/15 px-1 py-0.5 text-primary-800 dark:bg-primary-400/20 dark:text-primary-200"
                      style={{ marginLeft: `${(from / days) * 100}%`, width: `${((to - from) / days) * 100}%` }}
                      title={describe(e)}
                    >
                      {name(e)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* time grid */}
          <div className="grid" style={columns}>
            <div>
              {hours.map((h) => (
                <div key={h} className="pr-1 text-right text-[10px] text-stone-500 dark:text-stone-400" style={{ height: HOUR_PX }}>
                  {hourName.format(new Date(2000, 0, 1, h))}
                </div>
              ))}
            </div>
            {dates.map((_, day) => {
              const mine = pieces.filter((p) => p.day === day);
              const lane = lanes(mine);
              return (
                <div
                  key={day}
                  className={cn(
                    "relative border-l border-stone-200 dark:border-stone-700",
                    day === todayIndex && "bg-primary-50/40 dark:bg-primary-950/20",
                  )}
                  style={{ height: hours.length * HOUR_PX }}
                >
                  {hours.map((h, i) => (
                    <div
                      key={h}
                      className="absolute inset-x-0 border-t border-stone-100 dark:border-stone-800"
                      style={{ top: i * HOUR_PX }}
                    />
                  ))}
                  {mine.map((p, i) => {
                    const { lane: l, of } = lane.get(p)!;
                    const tall = at(p.to) - at(p.from);
                    return (
                      <div
                        key={i}
                        className={cn(
                          "absolute overflow-hidden rounded border border-primary-600/30 bg-primary-600/15 px-1 leading-tight text-primary-900 dark:border-primary-400/30 dark:bg-primary-400/20 dark:text-primary-100",
                          // A short event is one line, centred, rather than a clipped one.
                          tall < 20 ? "flex items-center py-0 text-[10px]" : "py-0.5",
                        )}
                        style={{
                          top: at(p.from) + 1,
                          height: Math.max(tall - 2, 14),
                          left: `calc(${(l / of) * 100}% + 1px)`,
                          width: `calc(${100 / of}% - 2px)`,
                        }}
                        title={describe(p.whole)}
                      >
                        <div className="min-w-0 truncate font-medium">{name(p.whole)}</div>
                        {tall >= 28 && (
                          <div className="truncate text-[10px] opacity-80">
                            {clock(p.from)}
                            {p.location ? ` · ${p.location}` : ""}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {(events.length === 0 || calendar.url) && (
        <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-2.5 py-1.5 dark:border-stone-700">
          <span className="text-stone-500 dark:text-stone-400">{events.length === 0 ? labels.noEvents : ""}</span>
          {calendar.url && link(calendar.url, labels.openCalendar)}
        </div>
      )}
    </div>
  );
}
