/**
 * Calendar arithmetic for the newsroom. Every date the newsroom talks about is
 * a day in America/Los_Angeles, so the conversions live in one place: this
 * module owns "what day is it", and the plan, runner, shortlist, publisher and
 * store all borrow it.
 *
 * The newsroom's day is a Los Altos day, so "this weekend" is Friday through
 * Sunday on a Los Altos wall clock, not on a UTC one. A launch at 02:00 UTC on
 * Saturday is Friday evening here and belongs to this weekend; a launch at
 * 05:00 UTC on Friday is Thursday night here and does not.
 */

export const TZ = "America/Los_Angeles";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function localParts(at: Date): { date: string; hour: number; minute: number } {
  const parts = partsFmt.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

/** The YYYY-MM-DD calendar day in Los Altos at that instant. */
export function localDate(at: Date): string {
  return localParts(at).date;
}

/** The hour of the day (0-23) in Los Altos at that instant. */
export function localHour(at: Date): number {
  return localParts(at).hour;
}

/** Accepts either a newsroom date string or an instant, and returns the date string. */
export function asDateString(date: string | Date): string {
  return typeof date === "string" ? date : localDate(date);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Midnight UTC on that calendar day, used only for weekday and week arithmetic. */
function calendarDay(date: string): Date {
  if (!DATE_RE.test(date)) throw new Error(`not a YYYY-MM-DD date: ${date}`);
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) throw new Error(`not a real date: ${date}`);
  return at;
}

/** 0 = Sunday, matching Date#getDay() and RHYTHM. */
export function weekdayOf(date: string | Date): number {
  return calendarDay(asDateString(date)).getUTCDay();
}

/** ISO-8601 week-numbering year and week for a calendar day. */
export function isoWeekOf(date: string | Date): { year: number; week: number } {
  const at = calendarDay(asDateString(date));
  // Shift to the Thursday of this ISO week: its calendar year is the week-year.
  const mondayIndex = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - mondayIndex + 3);
  const year = at.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstMondayIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstMondayIndex + 3);
  const week = 1 + Math.round((at.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year, week };
}

/** The plan file a day belongs to, e.g. 2026-W39.md. */
export function isoWeekFile(date: string | Date): string {
  const { year, week } = isoWeekOf(date);
  return `${year}-W${String(week).padStart(2, "0")}.md`;
}

/** Calendar days after a date string, as a date string. */
export function addDays(date: string, days: number): string {
  const at = calendarDay(date);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Parses an ISO instant, returning undefined rather than an Invalid Date. */
export function parseInstant(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Milliseconds the newsroom clock is ahead of UTC at `at` (negative in California). */
function offsetAt(at: Date): number {
  const p: Record<string, number> = {};
  for (const part of PARTS.formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value);
  const asIfUtc = Date.UTC(p["year"] ?? 0, (p["month"] ?? 1) - 1, p["day"] ?? 1, p["hour"] ?? 0, p["minute"] ?? 0, p["second"] ?? 0, at.getUTCMilliseconds());
  return asIfUtc - at.getTime();
}

/**
 * The instant at which a wall clock in the newsroom's zone reads `date` at the
 * given time. Two passes, because the offset depends on the answer; exact
 * except inside the repeated hour of a fall-back, which no rule turns on.
 */
export function instantAt(date: string, hour: number, minute = 0, second = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute, second, 0);
  const guess = new Date(naive - offsetAt(new Date(naive)));
  return new Date(naive - offsetAt(guess));
}

/**
 * This weekend: Friday 00:00:00.000 through Sunday 23:59:59.999, local.
 * Monday through Friday it is the weekend ahead; on Saturday and Sunday it is
 * the weekend already under way, so a Saturday run still covers today.
 */
export function weekendWindow(now: Date): { from: Date; to: Date } {
  const today = localDate(now);
  const weekday = weekdayOf(today);
  const toFriday = weekday === 0 ? -2 : weekday === 6 ? -1 : 5 - weekday;
  const friday = addDays(today, toFriday);
  const sunday = addDays(friday, 2);
  // The last millisecond of Sunday: no zone changes offset at 23:59, so the
  // 999 is plain arithmetic on top of the second instantAt resolves.
  return {
    from: instantAt(friday, 0, 0, 0),
    to: new Date(instantAt(sunday, 23, 59, 59).getTime() + 999),
  };
}
