import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import "../app/src/i18n";
import { CalendarView, parseCalendar } from "./CalendarView";

const labels = {
  locale: "en",
  allDay: "All day",
  openCalendar: "Open the calendar",
  noEvents: "No events",
  noTitle: "(no title)",
  invalid: (e: string) => `Invalid: ${e}`,
};
const link = (href: string, children: ReactNode) => (
  <a href={href} data-testid="link">
    {children}
  </a>
);

const DAY = 24 * 60;

describe("parseCalendar", () => {
  it("says why a block is not a calendar", () => {
    expect(parseCalendar("{")).toHaveProperty("error");
    expect(parseCalendar("null")).toEqual({ error: "expected an object" });
    expect(parseCalendar("[]")).toEqual({ error: "expected an object" });
    expect(parseCalendar("3")).toEqual({ error: "expected an object" });
    expect(parseCalendar("{}")).toEqual({ error: "expected a start date, YYYY-MM-DD" });
    expect(parseCalendar('{"start": "  "}')).toEqual({ error: "expected a start date, YYYY-MM-DD" });
    expect(parseCalendar('{"start": "someday"}')).toEqual({ error: "expected a start date, YYYY-MM-DD" });
    vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
      throw "odd";
    });
    expect(parseCalendar("{}")).toEqual({ error: "odd" });
  });

  it("bounds the days shown", () => {
    const days = (d: unknown) => {
      const r = parseCalendar(JSON.stringify({ start: "2026-10-20", days: d }));
      return "error" in r ? -1 : r.days;
    };
    expect(days(undefined)).toBe(7);
    expect(days("many")).toBe(7);
    expect(days(0)).toBe(1);
    expect(days(30)).toBe(7);
    expect(days(2.6)).toBe(3);
  });

  it("reads events as minutes from the first day, dropping what it cannot place", () => {
    const r = parseCalendar(
      JSON.stringify({
        start: "2026-10-20T08:00",
        days: 2,
        title: " Week ",
        url: "ftp://x",
        events: "not a list",
      }),
    );
    expect(r).toMatchObject({ title: "Week", days: 2, url: undefined, events: [] });
    const r2 = parseCalendar(
      JSON.stringify({
        start: "2026-10-20",
        days: 2,
        events: [
          null,
          "x",
          {},
          { start: "bad" },
          { title: "A", start: "2026-10-20T09:00:30.5", location: "Room", url: "https://cal/a" },
          { title: "B", start: "2026-10-20T10:00", end: "2026-10-20T09:00" },
          { title: "C", start: "2026-10-21" },
          { title: "D", start: "2026-10-20T10:00", end: "2026-10-21T10:00", allDay: true },
          { title: "Before", start: "2026-10-01T10:00" },
          { title: "After", start: "2026-10-23T10:00" },
          { title: "Zulu", start: "2026-10-20T12:00:00Z" },
        ],
      }),
    );
    if ("error" in r2) throw new Error(r2.error);
    const byTitle = Object.fromEntries(r2.events.map((e) => [e.title, e]));
    expect(byTitle.A).toEqual({ title: "A", from: 540, to: 600, allDay: false, location: "Room", url: "https://cal/a" });
    expect(byTitle.B).toMatchObject({ from: 600, to: 630 });
    expect(byTitle.C).toMatchObject({ from: DAY, to: 2 * DAY, allDay: true });
    expect(byTitle.D).toMatchObject({ from: 0, to: 2 * DAY, allDay: true });
    expect(byTitle.Before).toBeUndefined();
    expect(byTitle.After).toBeUndefined();
    expect(byTitle.Zulu).toBeDefined();
  });
});

describe("CalendarView", () => {
  it("shows the text and why when it is not a calendar", () => {
    render(<CalendarView text="nope" labels={labels} link={link} />);
    expect(screen.getByText(/^Invalid:/)).toBeTruthy();
    expect(screen.getByText("nope")).toBeTruthy();
  });

  it("draws a few days with all-day and timed events in lanes, today marked", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    const text = JSON.stringify({
      title: "My week",
      start: "2026-10-20",
      days: 3,
      url: "https://cal.example/week",
      events: [
        { title: "Standup", start: "2026-10-20T09:00", end: "2026-10-20T09:15", location: "Room" },
        { title: "Review", start: "2026-10-20T09:00", end: "2026-10-20T11:00", url: "https://cal/1" },
        { title: "", start: "2026-10-20T10:00", end: "2026-10-20T10:40" },
        { title: "Lunch", start: "2026-10-20T12:00", location: "Cafe" },
        { title: "Night", start: "2026-10-19T23:00", end: "2026-10-20T01:00" },
        { title: "Late", start: "2026-10-21T22:00", end: "2026-10-22T00:00" },
        { title: "Long", start: "2026-10-22T23:00", end: "2026-10-23T02:00" },
        { title: "Holiday", start: "2026-10-21" },
        { title: "", start: "2026-10-20", end: "2026-10-22", allDay: true, url: "https://cal/2" },
        { title: "Trip", start: "2026-10-19T10:00", end: "2026-10-21T10:00", allDay: true },
      ],
    });
    const { container } = render(<CalendarView text={text} labels={labels} link={link} />);
    expect(screen.getByText("My week")).toBeTruthy();
    expect(screen.getByText("All day")).toBeTruthy();
    // Titles become links only with an http(s) url; a missing title reads "(no title)".
    const links = screen.getAllByTestId("link").map((a) => [a.getAttribute("href"), a.textContent]);
    expect(links).toEqual(
      expect.arrayContaining([
        ["https://cal/1", "Review"],
        ["https://cal/2", "(no title)"],
        ["https://cal.example/week", "Open the calendar"],
      ]),
    );
    expect(screen.queryByText("No events")).toBeNull();
    // Hover text describes each event: title, time or "All day", location.
    const titles = [...container.querySelectorAll("[title]")].map((e) => e.getAttribute("title"));
    expect(titles).toContain("Holiday · All day");
    expect(titles.some((t) => t?.startsWith("Standup · ") && t.endsWith(" · Room"))).toBe(true);
    expect(titles.some((t) => t?.startsWith("Late · 10:00"))).toBe(true);
    // Lunch is tall enough for its time and place.
    expect(container.textContent).toContain(" · Cafe");
    // Overlapping events split the column; Standup and Review sit side by side.
    const review = [...container.querySelectorAll<HTMLElement>("[title^='Review']")][0];
    expect(review.style.width).toContain("50%");
    // The night before starts the grid at midnight.
    expect(container.textContent).toContain("12 AM");
    // Today's column is highlighted.
    expect(container.querySelectorAll(".bg-primary-50").length).toBe(1);
    expect(container.querySelector("[style*='min-width']")).toBeNull();
  });

  it("says when a wider range has no events, and has no title or link", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    const { container } = render(
      <CalendarView text={JSON.stringify({ start: "2020-01-06", days: 5, events: [] })} labels={labels} link={link} />,
    );
    expect(screen.getByText("No events")).toBeTruthy();
    expect(screen.queryByTestId("link")).toBeNull();
    expect(screen.queryByText("All day")).toBeNull();
    expect(container.querySelector(".bg-primary-50")).toBeNull();
    expect((container.querySelector("[style*='min-width']") as HTMLElement).style.minWidth).toBe("520px");
  });

  it("has no footer when there are events and no link", () => {
    const { container } = render(
      <CalendarView
        text={JSON.stringify({ start: "2026-10-20", days: 1, events: [{ title: "A", start: "2026-10-20T19:00" }] })}
        labels={labels}
        link={link}
      />,
    );
    expect(screen.queryByText("No events")).toBeNull();
    expect(container.querySelector(".border-t.border-stone-200.px-2\\.5")).toBeNull();
    // An evening event stretches the grid past 6 PM.
    expect(container.textContent).toContain("7 PM");
  });
});
