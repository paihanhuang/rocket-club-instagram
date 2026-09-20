/**
 * Prompt assembly. Pure: no model, no disk, no clock. The guides are passed in
 * as text because the writer reads them once, at createWriter.
 */
import { z } from "zod";
import { draftTextSchema } from "../newsroom/schemas.js";
import type { Assignment, Item, LicensedPhoto, Pillar, Shortlist } from "../newsroom/types.js";

/** A summary longer than this is cut; the model gets the gist, not the article. */
export const SUMMARY_MAX = 300;

/** The last line of the system prompt. The harness also enforces it structurally. */
export const JSON_ONLY = "Respond with a single JSON object matching the schema; no prose.";

/**
 * One note per pillar, kept in step with the "Pillar notes" section of
 * guides/voice.md. The guide is the editorial source of truth; this is the
 * single line the writer puts in front of the model for the day's pillar.
 */
export const PILLAR_NOTES: Record<Pillar, string> = {
  launches:
    "Pillar note (launches): what is flying this week, where to watch it, and one reason it matters. " +
    "Give every launch window with the day of week and the time zone, and say how to watch it from the Bay Area.",
  opportunities:
    "Pillar note (opportunities): who can apply (grade, age), the deadline, the cost, and one sentence on what you would actually do.",
  explainer:
    "Pillar note (explainer): one concept, built from a concrete example to the general rule. Say where the analogy breaks.",
  neighbors:
    "Pillar note (neighbors): what a nearby club or NASA Ames did, and how a high schooler could get involved. Credit them by name.",
  weekend:
    "Pillar note (weekend): events within about two hours' drive, with date, time, place and cost.",
  club:
    "Pillar note (club): our own build, launch or meeting. Names only with consent.",
  review:
    "Pillar note (review): the three biggest things this week, one line each, then one takeaway.",
};

/** The four-part caption the voice guide demands, restated as an instruction. */
export const CAPTION_STRUCTURE = [
  "Required caption structure, in this order:",
  "1. Hook: one line, under 90 characters, a fact or a question. No emoji in the hook.",
  "2. Body: two or three plain sentences. What happened, why a high schooler in the South Bay would care, what to do about it.",
  "3. Next step: one clear action the reader can take.",
  '4. Source line: the exact text of the "sourceLine" field, as the last line of the caption. It starts with "Source:".',
  "",
  'Put five to eight lowercase hashtags in "hashtags" (no "#", no spaces); "rocketry" and "lahs" are always among them.',
  'Put every uncertainty in "flags": an unconfirmed date, place, deadline, eligibility rule or cost means the flag "confirm before posting", never a guess.',
].join("\n");

export type Guides = { voice: string; fence: string };

export type PromptInput = {
  assignment: Assignment;
  shortlist: Shortlist;
  photo?: LicensedPhoto | undefined;
  guides: Guides;
};

export type AssembledPrompt = {
  system: string;
  user: string;
  jsonSchema: Record<string, unknown>;
};

/** Cuts `text` so the result is never longer than `max` characters. */
export function trimTo(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/** One shortlist item, compact: what the model needs and nothing else. */
export function renderItem(item: Item, index: number): string {
  const lines = [`[${index + 1}] ${item.title}`];
  if (item.startsAt) lines.push(`    startsAt: ${humanPT(item.startsAt)} (${item.startsAt})`);
  if (item.deadlineAt) lines.push(`    deadlineAt: ${humanPT(item.deadlineAt)} (${item.deadlineAt})`);
  if (item.location) lines.push(`    location: ${item.location.name}`);
  lines.push(`    url: ${item.url}`);
  lines.push(`    summary: ${trimTo(item.summary, SUMMARY_MAX)}`);
  return lines.join("\n");
}

export function renderShortlist(shortlist: Shortlist): string {
  if (shortlist.items.length === 0) {
    return "# Shortlist (0 items)\n(empty: no material passed the filter; do not invent any)";
  }
  const body = shortlist.items.map((item, i) => renderItem(item, i)).join("\n");
  return `# Shortlist (${shortlist.items.length} items)\n${body}`;
}

/** The JSON Schema the model's answer must satisfy. Derived from the zod contract. */
export function draftJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(draftTextSchema, { target: "draft-2020-12" }) as Record<string, unknown>;
}

/**
 * Builds the two messages and the schema. Deterministic, so it can be asserted
 * against golden text without a model anywhere near the test.
 */
export function assemblePrompt(input: PromptInput): AssembledPrompt {
  const { assignment, shortlist, photo, guides } = input;

  const system = [
    guides.voice.trim(),
    guides.fence.trim(),
    PILLAR_NOTES[assignment.pillar],
    JSON_ONLY,
  ].join("\n\n");

  const parts = [
    ["# Assignment", `date: ${assignment.date} (${weekdayOf(assignment.date)})`, `pillar: ${assignment.pillar}`, `angle: ${assignment.angle}`].join(
      "\n",
    ),
    renderShortlist(shortlist),
  ];

  if (photo) {
    parts.push(
      `# Photo\nA licensed photo from ${photo.source} will appear on the cover; mention nothing about it in the caption.`,
    );
  }

  parts.push(CAPTION_STRUCTURE);

  return { system, user: parts.join("\n\n"), jsonSchema: draftJsonSchema() };
}


const PT_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** "Tue Sep 29, 6:10 PM PT" for an ISO timestamp, so the model never computes weekdays itself. */
export function humanPT(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${PT_FORMAT.format(d).replace(",", "").replace(" at ", ", ")} PT`;
}

/** Weekday name for a YYYY-MM-DD date, computed here so the model never guesses it. */
export function weekdayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(d);
}
