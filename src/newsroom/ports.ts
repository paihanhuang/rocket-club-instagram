/**
 * Ports: the seams where a real adapter (network, disk, model) and a fake meet.
 * Every module that talks to the outside world takes one of these instead of
 * reaching for the global. Production passes the real thing; tests pass a fake.
 */
import type { Draft, DraftStatus, LicensedPhoto, Post, Slide, Verdict } from "./types.js";

/** The one injected network dependency. Same shape as the global fetch. */
export type Fetch = typeof fetch;

export type Clock = () => Date;

/** Generates a JSON object for a prompt. Never retries; the writer owns retries. */
export type Generate = (req: {
  system: string;
  user: string;
  /** JSON Schema (draft 2020-12) the output must satisfy. */
  jsonSchema: Record<string, unknown>;
  wallTimeMs: number;
}) => Promise<{ raw: string; json: unknown }>;

export type DraftStore = {
  save(draft: Draft): Promise<void>;
  get(id: string): Promise<Draft | undefined>;
  list(filter?: { status?: DraftStatus | DraftStatus[] }): Promise<Draft[]>;
  /** Throws if `from` is not the current status or the transition is illegal. */
  transition(id: string, from: DraftStatus, to: DraftStatus, patch?: Partial<Draft>): Promise<Draft>;
};

export type DiscordPort = {
  /** Posts the draft card (slides + copyable caption + flags). Returns the message id. */
  postDraft(draft: Draft, slides: Slide[]): Promise<{ messageId: string }>;
  /** Reads reactions on the draft's message; only listed approvers count. */
  readVerdict(draft: Draft): Promise<Verdict | undefined>;
  notify(text: string): Promise<void>;
};

export type ImageHostPort = {
  /** Makes files public. Returns one URL per file, same order. */
  publish(files: { name: string; path: string }[]): Promise<string[]>;
  /** Resolves when every URL returns 200 with an image content type, or throws after the deadline. */
  waitUntilServed(urls: string[], opts?: { timeoutMs?: number }): Promise<void>;
  /** Removes files after Instagram has fetched them. */
  remove(names: string[]): Promise<void>;
};

export type InstagramPort = {
  createImageContainer(req: { imageUrl: string; caption?: string; isCarouselItem?: boolean }): Promise<{ id: string }>;
  createCarouselContainer(req: { children: string[]; caption: string }): Promise<{ id: string }>;
  containerStatus(id: string): Promise<"IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED">;
  publish(containerId: string): Promise<{ mediaId: string; permalink?: string }>;
  quota(): Promise<{ used: number; total: number }>;
  /** Refreshes the long-lived token; returns the new token and its expiry. */
  refreshToken(): Promise<{ token: string; expiresAt: string }>;
  /** Identity check for doctor: the account the token belongs to. */
  me(): Promise<{ id: string; username: string }>;
};

export type PhotoStore = {
  /** Consented club photos dropped by officers; the license module reads these. */
  listClubPhotos(): Promise<LicensedPhoto[]>;
};

export type PublishReport = {
  at: string;
  windowOpen: boolean;
  considered: number;
  posts: Post[];
  skipped: { draftId: string; reason: string }[];
  failed: { draftId: string; step: string; message: string }[];
  tokenRefreshed?: boolean;
};
