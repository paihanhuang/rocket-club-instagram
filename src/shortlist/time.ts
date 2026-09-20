/**
 * Calendar arithmetic in a named time zone, without a date library.
 *
 * The newsroom's day is a Los Altos day, so "this weekend" is Friday through
 * Sunday on a Los Altos wall clock, not on a UTC one. A launch at 02:00 UTC on
 * Saturday is Friday evening here and belongs to this weekend; a launch at
 * 05:00 UTC on Friday is Thursday night here and does not.
 */

export const NEWSROOM_TZ = "America/Los_Angeles";

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const PARTS = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let existing = PARTS.get(tz);
  if (!existing) {
    existing = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    PARTS.set(tz, existing);
  }
  return existing;
}

/** What a wall clock in `tz` reads at the instant `at`. */
export function wallClock(at: Date, tz: string): WallClock {
  const found: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(at)) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year ?? 0,
    month: found.month ?? 1,
    day: found.day ?? 1,
    hour: found.hour ?? 0,
    minute: found.minute ?? 0,
    second: found.second ?? 0,
  };
}

/** The zone's offset from UTC at that instant, in milliseconds (PDT is -7h). */
function offsetAt(at: Date, tz: string): number {
  const local = wallClock(at, tz);
  const asIfUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    at.getUTCMilliseconds(),
  );
  return asIfUtc - at.getTime();
}

/**
 * The instant at which a wall clock in `tz` reads the given date and time.
 * Two passes, because the offset depends on the answer: guess with the offset
 * at the naive instant, then correct with the offset at the guess. That is
 * exact everywhere except inside the hour a fall-back repeats, which no
 * newsroom rule turns on.
 */
export function zonedTime(
  tz: string,
  date: { year: number; month: number; day: number },
  time: { hour: number; minute: number; second: number; ms: number },
): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, time.second, time.ms);
  const guess = new Date(naive - offsetAt(new Date(naive), tz));
  return new Date(naive - offsetAt(guess, tz));
}

/** 0 = Sunday, as in Date#getDay(). */
function weekdayOf(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

function addDays(date: { year: number; month: number; day: number }, days: number) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * This weekend: Friday 00:00:00 through Sunday 23:59:59.999, local.
 * Monday through Friday it is the weekend ahead; on Saturday and Sunday it is
 * the weekend already under way, so a Saturday run still covers today.
 */
export function weekendWindow(now: Date, tz: string = NEWSROOM_TZ): { from: Date; to: Date } {
  const today = wallClock(now, tz);
  const weekday = weekdayOf(today);
  const toFriday = weekday === 0 ? -2 : weekday === 6 ? -1 : 5 - weekday;
  const friday = addDays(today, toFriday);
  const sunday = addDays(friday, 2);
  return {
    from: zonedTime(tz, friday, { hour: 0, minute: 0, second: 0, ms: 0 }),
    to: zonedTime(tz, sunday, { hour: 23, minute: 59, second: 59, ms: 999 }),
  };
}
