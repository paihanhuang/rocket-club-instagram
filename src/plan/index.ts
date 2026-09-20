/**
 * The plan: the week's seven assignments, one per day, written by the chief.
 *
 * A plan file is Markdown at `<planDir>/<YYYY>-W<ww>.md` (ISO week) and the
 * only lines that matter look like:
 *
 *     - 2026-09-26 | explainer | Who we are and what we launch
 *
 * Anything else in the file is prose for humans and is ignored. When the week
 * has no file, or the file has no line for the day, the rhythm decides the
 * pillar and a standing angle fills in, so the worker never stalls for want of
 * an editor.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PILLARS, RHYTHM, type Assignment, type Pillar } from "../newsroom/types.js";
import { asDateString, isoWeekFile, weekdayOf } from "./time.js";

export { isoWeekFile, isoWeekOf, localDate, localHour, weekdayOf, TZ } from "./time.js";

/** The angle used when the chief wrote no line for the day. One per pillar. */
export const DEFAULT_ANGLES: Record<Pillar, string> = {
  launches: "the next launch worth watching and how to follow it from the Bay Area",
  opportunities: "one open program or deadline a South Bay high schooler can still act on",
  explainer: "one piece of rocket science explained in plain language",
  neighbors: "what a Bay Area space company, lab or museum has been doing",
  weekend: "one space thing to do this weekend within driving distance",
  club: "what the club has been building, testing or learning",
  review: "the week in three things worth remembering",
};

const LINE_RE = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*\|\s*([A-Za-z]+)\s*\|\s*(\S.*?)\s*$/;

const isPillar = (value: string): value is Pillar =>
  (PILLARS as readonly string[]).includes(value);

/**
 * Every assignment line in a plan, in file order. Lines that are not
 * assignments, and assignment-shaped lines naming an unknown pillar, are
 * skipped: a typo in the plan costs that day its angle, not the whole run.
 */
export function parsePlan(markdown: string): Assignment[] {
  const assignments: Assignment[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const [, date, rawPillar, angle] = match;
    if (!date || !rawPillar || !angle) continue;
    const pillar = rawPillar.toLowerCase();
    if (!isPillar(pillar)) continue;
    assignments.push({ date, pillar, angle });
  }
  return assignments;
}

/** The pillar and angle the rhythm gives a day with no line in the plan. */
export function fallbackAssignment(date: string): Assignment {
  const pillar = RHYTHM[weekdayOf(date)] ?? "explainer";
  return { date, pillar, angle: DEFAULT_ANGLES[pillar] };
}

/**
 * The assignment for one day. A line for that exact date wins; otherwise the
 * rhythm decides. Never throws for a missing or unreadable plan file.
 */
export async function readAssignment(date: string | Date, planDir: string): Promise<Assignment> {
  const day = asDateString(date);
  const file = join(planDir, isoWeekFile(day));
  let markdown: string;
  try {
    markdown = await readFile(file, "utf8");
  } catch {
    return fallbackAssignment(day);
  }
  const assigned = parsePlan(markdown).find((a) => a.date === day);
  return assigned ?? fallbackAssignment(day);
}
