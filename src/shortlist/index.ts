/**
 * shortlist: `shortlist(items, assignment, opts)` — the filtered and ranked
 * items handed to the writer for one assignment.
 *
 * Pure: same items, same assignment, same `now` and `home`, same shortlist.
 * Behind the seam: one rule per pillar — time windows, distance from Los
 * Altos, dedupe and ranking — and a `notes` line for every rule that dropped
 * something, so a thin shortlist can always be explained.
 */
import type { Assignment, Item, Shortlist } from "../newsroom/types.js";
import { distanceKm, type Point } from "./geo.js";
import { NEWSROOM_TZ, weekendWindow } from "./time.js";
import { instantAt } from "../plan/time.js";

/** The publisher may post from 3pm local on the assignment day; nothing earlier can be announced. */
const PUBLISH_WINDOW_HOUR = 15;

/** Los Altos High School. The weekend pillar measures from here. */
export const LOS_ALTOS: Point = { lat: 37.3852, lon: -122.1141 };

export type ShortlistOptions = {
  now: Date;
  home: Point;
};

/**
 * Extras a source may hang off an Item to help the ranking. They are not part
 * of the shared domain type, so an item without them simply scores lower;
 * `vehicle` falls back to the title, which is where Launch Library puts it.
 */
type Rankable = Item & {
  vehicle?: string;
  webcast?: { url: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Vehicles worth putting on a card: a reader has heard of these. */
const NAMED_VEHICLES = [
  "Falcon 9",
  "Starship",
  "Electron",
  "New Glenn",
  "Vulcan",
  "Ariane 6",
  "Atlas V",
  "Long March",
];

const WEEKEND_RADIUS_KM = 500;

const MAX = {
  launches: 5,
  weekend: 5,
  review: 6,
  opportunities: 4,
  neighbors: 4,
} as const;

function at(stamp: string | undefined): number | undefined {
  if (!stamp) return undefined;
  const ms = Date.parse(stamp);
  return Number.isNaN(ms) ? undefined : ms;
}

/** `publishedAt`, else when it happens, else when it was fetched. */
function recency(item: Item): number {
  return at(item.publishedAt) ?? at(item.startsAt) ?? at(item.fetchedAt) ?? 0;
}

function hasNamedVehicle(item: Rankable): boolean {
  const haystack = `${item.vehicle ?? ""} ${item.title}`.toLowerCase();
  return NAMED_VEHICLES.some((v) => haystack.includes(v.toLowerCase()));
}

/** A pad we can name and point at, a rocket a reader knows, and something to watch. */
function launchScore(item: Rankable): number {
  return (
    (item.location ? 1 : 0) + (hasNamedVehicle(item) ? 1 : 0) + (item.webcast?.url ? 1 : 0)
  );
}

function isNasa(item: Item): boolean {
  if (item.source.toLowerCase() === "nasa") return true;
  try {
    return new URL(item.url).hostname.toLowerCase().endsWith("nasa.gov");
  } catch {
    return false;
  }
}

/** Lowercase, punctuation out, first sixty characters: the same story twice reads the same. */
function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

class Notes {
  readonly lines: string[];

  constructor(carried: readonly string[]) {
    this.lines = [...carried];
  }

  dropped(pillar: string, count: number, total: number, why: string): void {
    if (count > 0) this.lines.push(`${pillar}: dropped ${count} of ${total} ${why}`);
  }

  say(line: string): void {
    this.lines.push(line);
  }

  cap<T>(pillar: string, how: string, items: T[], max: number): T[] {
    if (items.length <= max) return items;
    this.lines.push(`${pillar}: kept the ${how} ${max} of ${items.length}`);
    return items.slice(0, max);
  }
}

/** Sources attach their own notes (a stale cache, a dead feed); they belong in the shortlist. */
function carriedNotes(items: Item[]): readonly string[] {
  const carried = (items as Item[] & { notes?: unknown }).notes;
  return Array.isArray(carried) ? carried.filter((n): n is string => typeof n === "string") : [];
}

/** Within the next seven days, best first, soonest breaking a tie. */
function notBeforeWindow(items: Item[], windowOpens: number, notes: Notes, pillar: string): Item[] {
  const kept = items.filter((i) => {
    const starts = at(i.startsAt);
    return starts === undefined || starts >= windowOpens;
  });
  notes.dropped(pillar, items.length - kept.length, items.length, "launches before the publish window on the assignment day");
  return kept;
}

function pickLaunches(items: Item[], opts: ShortlistOptions, notes: Notes, pillar: string, windowOpens: number): Item[] {
  const from = opts.now.getTime();
  const until = from + 7 * DAY_MS;
  const inWeek = items.filter((i) => {
    const starts = at(i.startsAt);
    return starts !== undefined && starts >= from && starts <= until;
  });
  notes.dropped(pillar, items.length - inWeek.length, items.length, "launches outside the next 7 days");
  const upcoming = notBeforeWindow(inWeek, windowOpens, notes, pillar);

  const ranked = [...upcoming].sort((a, b) => {
    const byScore = launchScore(b as Rankable) - launchScore(a as Rankable);
    return byScore !== 0 ? byScore : (at(a.startsAt) ?? 0) - (at(b.startsAt) ?? 0);
  });
  return notes.cap(pillar, "best", ranked, MAX.launches);
}

/** This weekend, close enough to walk outside and look up. */
function pickWeekend(items: Item[], opts: ShortlistOptions, notes: Notes, windowOpens: number): Item[] {
  const { from, to } = weekendWindow(opts.now);
  items = notBeforeWindow(items, windowOpens, notes, "weekend");
  const thisWeekend = items.filter((i) => {
    const starts = at(i.startsAt);
    return starts !== undefined && starts >= from.getTime() && starts <= to.getTime();
  });
  notes.dropped(
    "weekend",
    items.length - thisWeekend.length,
    items.length,
    `launches outside Friday to Sunday in ${NEWSROOM_TZ}`,
  );

  const nearby = thisWeekend.filter(
    (i) => i.location !== undefined && distanceKm(opts.home, i.location) <= WEEKEND_RADIUS_KM,
  );
  notes.dropped(
    "weekend",
    thisWeekend.length - nearby.length,
    thisWeekend.length,
    `launches more than ${WEEKEND_RADIUS_KM} km from home`,
  );

  const chronological = [...nearby].sort((a, b) => (at(a.startsAt) ?? 0) - (at(b.startsAt) ?? 0));

  // One local launch is not a weekend guide. Fall back to the week's best
  // launches rather than hand the writer an empty page.
  if (chronological.length >= 2) return notes.cap("weekend", "first", chronological, MAX.weekend);

  notes.say("no local launches this weekend");
  const filled = [...chronological];
  const seen = new Set(filled.map((i) => i.id));
  for (const item of pickLaunches(items, opts, new Notes([]), "weekend", windowOpens)) {
    if (!seen.has(item.id)) {
      filled.push(item);
      seen.add(item.id);
    }
  }
  return notes.cap("weekend", "first", filled, MAX.weekend);
}

/** The last seven days, one item per story, NASA's telling preferred. */
function pickReview(items: Item[], opts: ShortlistOptions, notes: Notes): Item[] {
  const until = opts.now.getTime();
  const from = until - 7 * DAY_MS;
  const recent = items.filter((i) => {
    const published = at(i.publishedAt);
    return published !== undefined && published >= from && published <= until;
  });
  notes.dropped("review", items.length - recent.length, items.length, "articles older than 7 days");

  const byStory = new Map<string, Item>();
  for (const item of recent) {
    const key = titleKey(item.title);
    const kept = byStory.get(key);
    if (!kept) {
      byStory.set(key, item);
      continue;
    }
    // On a tie, NASA's own account of its own news wins; otherwise the newest.
    const preferNew = isNasa(item) !== isNasa(kept) ? isNasa(item) : recency(item) > recency(kept);
    if (preferNew) byStory.set(key, item);
  }
  const deduped = [...byStory.values()];
  const duplicates = recent.length - deduped.length;
  if (duplicates > 0) {
    notes.say(`review: dropped ${duplicates} duplicate ${duplicates === 1 ? "title" : "titles"}`);
  }

  deduped.sort((a, b) => recency(b) - recency(a));
  return notes.cap("review", "most recent", deduped, MAX.review);
}

/** Still worth applying for: more than two days left. */
function pickOpportunities(items: Item[], opts: ShortlistOptions, notes: Notes): Item[] {
  const cutoff = opts.now.getTime() + 2 * DAY_MS;
  const open = items.filter((i) => {
    const deadline = at(i.deadlineAt);
    return deadline !== undefined && deadline > cutoff;
  });
  notes.dropped(
    "opportunities",
    items.length - open.length,
    items.length,
    "without a deadline more than 2 days away",
  );

  open.sort((a, b) => (at(a.deadlineAt) ?? 0) - (at(b.deadlineAt) ?? 0));
  return notes.cap("opportunities", "soonest", open, MAX.opportunities);
}

function pickNeighbors(items: Item[], notes: Notes): Item[] {
  const newest = [...items].sort((a, b) => recency(b) - recency(a));
  return notes.cap("neighbors", "most recent", newest, MAX.neighbors);
}

export function shortlist(
  items: Item[],
  assignment: Assignment,
  opts: ShortlistOptions,
): Shortlist {
  const notes = new Notes(carriedNotes(items));
  const windowOpens = instantAt(assignment.date, PUBLISH_WINDOW_HOUR).getTime();

  let picked: Item[];
  switch (assignment.pillar) {
    case "launches":
      picked = pickLaunches(items, opts, notes, "launches", windowOpens);
      break;
    case "weekend":
      picked = pickWeekend(items, opts, notes, windowOpens);
      break;
    case "review":
      picked = pickReview(items, opts, notes);
      break;
    case "opportunities":
      picked = pickOpportunities(items, opts, notes);
      break;
    case "neighbors":
      picked = pickNeighbors(items, notes);
      break;
    // The explainer and the club post are written from what the assignment
    // asks for; there is nothing to filter and nothing to explain away.
    case "explainer":
    case "club":
      picked = [...items];
      break;
  }

  return { assignment, items: picked, notes: notes.lines };
}
