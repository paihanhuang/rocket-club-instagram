/**
 * The invariants the writer enforces on the model's answer. The model is a
 * suggestion engine; these rules are the contract. Everything here is pure and
 * total: given any `unknown`, it returns something the schema can judge.
 */
import type { Assignment, Pillar, Shortlist } from "../newsroom/types.js";

export const REQUIRED_HASHTAGS = ["rocketry", "lahs"] as const;
export const MIN_HASHTAGS = 5;
export const MAX_HASHTAGS = 8;
export const MAX_SLIDES = 10;
export const MAX_FLAGS = 10;
export const MAX_CAPTION = 1800;
export const CONFIRM_FLAG = "confirm before posting";

/** Pillars whose posts are worthless if the date is wrong. */
export const TIME_SENSITIVE_PILLARS: readonly Pillar[] = ["launches", "weekend", "opportunities"];

/** Used only to pad a thin answer up to the five hashtags the schema demands. */
export const PILLAR_HASHTAGS: Record<Pillar, readonly string[]> = {
  launches: ["spacenews", "spaceflight", "bayarea", "launch"],
  opportunities: ["internship", "stemeducation", "students", "bayarea"],
  explainer: ["stemeducation", "spacenews", "physics", "modelrocketry"],
  neighbors: ["bayarea", "stemeducation", "nasaames", "spacenews"],
  weekend: ["bayarea", "weekend", "stemeducation", "spaceflight"],
  club: ["modelrocketry", "highschool", "bayarea", "stemeducation"],
  review: ["spacenews", "weeklyreview", "bayarea", "stemeducation"],
};

const GENERIC_HASHTAGS = ["space", "stem", "rockets"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Lowercased, stripped to [a-z0-9_], deduped, `rocketry` and `lahs` first so a
 * trim can never drop them, padded from the pillar list to five, cut to eight.
 */
export function normalizeHashtags(input: unknown, pillar: Pillar): string[] {
  const cleaned: string[] = [];
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw !== "string") continue;
      const tag = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (tag) cleaned.push(tag);
    }
  }

  const seen = new Set<string>();
  const out: string[] = [];
  const add = (tag: string): void => {
    if (seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  };

  for (const tag of REQUIRED_HASHTAGS) add(tag);
  for (const tag of cleaned) add(tag);
  for (const tag of [...PILLAR_HASHTAGS[pillar], ...GENERIC_HASHTAGS]) {
    if (out.length >= MIN_HASHTAGS) break;
    add(tag);
  }

  return out.slice(0, MAX_HASHTAGS);
}

/**
 * True when an approver must confirm a date before this goes out: a
 * time-sensitive pillar whose material is missing its own time, or no material
 * at all. "Any item used" is read as "any item on the shortlist", because the
 * model never tells us which ones it leaned on.
 */
export function needsConfirmFlag(shortlist: Shortlist): boolean {
  if (shortlist.items.length === 0) return true;
  if (!TIME_SENSITIVE_PILLARS.includes(shortlist.assignment.pillar)) return false;
  return shortlist.items.some((item) => !item.startsAt && !item.deadlineAt);
}

/**
 * Deduped, with the confirm flag guaranteed present (and kept) when it is owed.
 * A flag the model already spelled out ("confirm before posting: no time yet")
 * counts: the approver reads the words either way, and a bare duplicate beside
 * it is noise on the card.
 */
export function normalizeFlags(input: unknown, requireConfirm: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  if (Array.isArray(input)) {
    for (const raw of input) {
      if (typeof raw !== "string") continue;
      const flag = raw.trim();
      const key = flag.toLowerCase();
      if (!flag || seen.has(key)) continue;
      seen.add(key);
      out.push(flag);
    }
  }
  if (!requireConfirm) return out.slice(0, MAX_FLAGS);

  if (!out.some((flag) => flag.toLowerCase().includes(CONFIRM_FLAG))) {
    if (out.length >= MAX_FLAGS) out.length = MAX_FLAGS - 1;
    out.push(CONFIRM_FLAG);
  }
  return out.slice(0, MAX_FLAGS);
}

/** The caption must carry the source line verbatim; if the model forgot it, append it. */
export function ensureSourceLine(caption: string, sourceLine: string): string {
  if (!sourceLine || caption.includes(sourceLine)) return caption;
  const suffix = `\n\n${sourceLine}`;
  let body = caption.trimEnd();
  if (body.length + suffix.length > MAX_CAPTION) {
    body = body.slice(0, MAX_CAPTION - suffix.length).trimEnd();
  }
  return body + suffix;
}

function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.!?](\s|$)/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

/**
 * One to ten slides. Extra slides are dropped; an empty answer gets the cover
 * slide the voice guide describes (headline plus a one-line subtitle) so a
 * usable draft is not thrown away over a missing array.
 */
const HANDLE_LINE = /(^|\n)\s*@lahsrocketry\s*$/i;

/** The template prints the handle on every slide; a model that types it too gets it removed. */
function withoutHandle(slide: unknown): unknown {
  if (!isRecord(slide)) return slide;
  const out: Record<string, unknown> = { ...slide };
  for (const key of ["title", "body"]) {
    const value = out[key];
    if (typeof value === "string") out[key] = value.replace(HANDLE_LINE, "").trim();
  }
  return out;
}

export function normalizeSlides(input: unknown, headline: unknown, caption: unknown): unknown {
  if (Array.isArray(input) && input.length > MAX_SLIDES) return input.slice(0, MAX_SLIDES).map(withoutHandle);
  if (Array.isArray(input) && input.length > 0) return input.map(withoutHandle);
  if (typeof headline !== "string") return input;
  const title = headline.trim().slice(0, 60);
  if (!title) return input;
  const subtitle = typeof caption === "string" ? firstSentence(caption).slice(0, 320) : "";
  return [{ title, body: subtitle || title }];
}

/**
 * Applies every invariant the writer owns, then hands the result to the schema.
 * Anything that is not an object is returned untouched so zod can say so.
 */
export function normalizeDraft(
  answer: unknown,
  context: { assignment: Assignment; shortlist: Shortlist },
): unknown {
  if (!isRecord(answer)) return answer;

  const draft: Record<string, unknown> = { ...answer };

  draft["slides"] = normalizeSlides(draft["slides"], draft["headline"], draft["caption"]);
  draft["hashtags"] = normalizeHashtags(draft["hashtags"], context.assignment.pillar);
  draft["flags"] = normalizeFlags(draft["flags"], needsConfirmFlag(context.shortlist));

  const caption = draft["caption"];
  const sourceLine = draft["sourceLine"];
  if (typeof caption === "string" && typeof sourceLine === "string") {
    draft["caption"] = ensureSourceLine(caption, sourceLine.trim());
  }

  return draft;
}
