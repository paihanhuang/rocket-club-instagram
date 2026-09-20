/**
 * Calendar arithmetic for the newsroom. Every date the newsroom talks about is
 * a day in America/Los_Angeles, so the conversions live in one place: the plan
 * module owns "what day is it", and the runner and publisher borrow it.
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

export function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * HOUR_MS);
}

/** Parses an ISO instant, returning undefined rather than an Invalid Date. */
export function parseInstant(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}
