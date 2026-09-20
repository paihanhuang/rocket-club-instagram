/**
 * Domain types for the LAHS Rocketry Newsroom. Vocabulary: CONTEXT.md.
 * These are the words every module shares. Keep them free of transport details.
 */

export const PILLARS = [
  "launches",
  "opportunities",
  "explainer",
  "neighbors",
  "weekend",
  "club",
  "review",
] as const;
export type Pillar = (typeof PILLARS)[number];

/** Weekday → pillar. 0 = Sunday, as in Date#getDay(). */
export const RHYTHM: Record<number, Pillar> = {
  1: "launches",
  2: "opportunities",
  3: "explainer",
  4: "neighbors",
  5: "weekend",
  6: "club",
  0: "review",
};

/** One day's instruction from the plan. `date` is YYYY-MM-DD in America/Los_Angeles. */
export type Assignment = {
  date: string;
  pillar: Pillar;
  angle: string;
};

/** One piece of material from a source. Times are ISO 8601 with offset. */
export type Item = {
  id: string;
  source: string;
  title: string;
  url: string;
  summary: string;
  publishedAt?: string;
  /** When the thing happens (launch window open, event start, deadline). */
  startsAt?: string;
  /** For opportunities: the last moment to apply. */
  deadlineAt?: string;
  location?: { name: string; lat: number; lon: number };
  /** Candidate images with their stated license, for the license check. */
  images?: { url: string; license?: string; credit?: string; source: string }[];
  fetchedAt: string;
};

export type Shortlist = {
  assignment: Assignment;
  items: Item[];
  /** Human-readable reasons for the ranking, shown nowhere public. */
  notes: string[];
};

export type LicensedPhoto = {
  url: string;
  license: string;
  credit: string;
  source: string;
  /** Local file after download. */
  path: string;
};

/** What the writer must produce. The zod schema in schemas.ts is the contract. */
export type DraftText = {
  headline: string;
  slides: { title: string; body: string }[];
  caption: string;
  sourceLine: string;
  hashtags: string[];
  flags: string[];
};

export type DraftStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "publishing"
  | "published"
  | "failed";

export type Verdict = {
  decision: "approved" | "rejected";
  by: string;
  at: string;
  contentHash: string;
};

export type Slide = { path: string; width: number; height: number };

export type Draft = {
  id: string;
  assignment: Assignment;
  text: DraftText;
  slides: Slide[];
  photo?: LicensedPhoto;
  /** sha256 over text + slide file hashes. A verdict binds to this. */
  contentHash: string;
  createdAt: string;
  /** Latest useful publish time. From the item's own deadline or start when known, else createdAt + 36h. */
  publishBy: string;
  status: DraftStatus;
  discordMessageId?: string;
  verdict?: Verdict;
  publish?: {
    imageUrls: string[];
    containerIds: string[];
    carouselId?: string;
    mediaId?: string;
    permalink?: string;
  };
  error?: string;
};

export type Post = {
  draftId: string;
  mediaId: string;
  permalink?: string;
  publishedAt: string;
};

/** The legal status transitions. The store enforces these; nothing else changes status. */
export const TRANSITIONS: Record<DraftStatus, readonly DraftStatus[]> = {
  pending: ["approved", "rejected", "expired", "failed"],
  approved: ["publishing", "expired", "rejected"],
  publishing: ["published", "failed", "approved"],
  published: [],
  rejected: [],
  expired: [],
  failed: ["pending"],
};
