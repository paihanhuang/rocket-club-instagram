/**
 * The draft store: one JSON file per draft under `dir/<id>.json`.
 *
 * The directory belongs to the store: every `*.json` file in it is read back
 * as a draft, so nothing else may keep its own state there.
 *
 * It is the only place a draft's status changes. The runner and the publisher
 * ask it to `transition`; nothing else writes `status`. Every write lands
 * whole (temp file, then rename) so a crash mid-write cannot leave a draft
 * half-saved, and every read is validated against `draftSchema` so a hand-
 * edited file fails loudly instead of quietly publishing nonsense.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { draftSchema } from "../newsroom/schemas.js";
import type { DraftStore } from "../newsroom/ports.js";
import {
  TRANSITIONS,
  type Assignment,
  type Draft,
  type DraftStatus,
  type DraftText,
  type Item,
  type LicensedPhoto,
  type Slide,
} from "../newsroom/types.js";
import { DAY_MS, HOUR_MS, parseInstant } from "../plan/time.js";

/** A draft is not in the status the caller expected, or the move is not legal. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly draftId: string,
    readonly from: DraftStatus,
    readonly to: DraftStatus,
    readonly actual: DraftStatus,
  ) {
    super(
      from === actual
        ? `draft ${draftId}: ${from} → ${to} is not a legal transition`
        : `draft ${draftId}: expected status ${from} but found ${actual}`,
    );
    this.name = "IllegalTransitionError";
  }
}

export class DraftNotFoundError extends Error {
  constructor(readonly draftId: string) {
    super(`draft ${draftId}: no such draft`);
    this.name = "DraftNotFoundError";
  }
}

/** JSON with object keys in a fixed order, so the same content hashes the same. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * The hash a verdict binds to: the words plus the pixels. Changing a caption
 * or re-rendering a slide changes it, which is what makes an approval stale.
 */
export async function contentHashOf(text: DraftText, slidePaths: string[]): Promise<string> {
  const hash = createHash("sha256");
  hash.update(canonicalJson(text));
  for (const path of slidePaths) {
    hash.update("\n");
    hash.update(await readFile(path));
  }
  return hash.digest("hex");
}

export type NewDraftInput = {
  assignment: Assignment;
  text: DraftText;
  slides: Slide[];
  photo?: LicensedPhoto | undefined;
  now: Date;
  /** The items the draft was written from; their deadlines set `publishBy`. */
  items?: Item[] | undefined;
};

/** Longest a draft may wait for a verdict when nothing else sets the deadline. */
export const DEFAULT_SHELF_LIFE_MS = 36 * HOUR_MS;
/** A draft always gets this long, even when its material expires sooner. */
export const MIN_SHELF_LIFE_MS = 2 * HOUR_MS;
/** How far before an application deadline a post stops being useful. */
export const DEADLINE_LEAD_MS = DAY_MS;

/**
 * The last moment this draft is still worth publishing: before an application
 * deadline closes (with a day to act on it), before a launch happens, and in
 * any case a day and a half after it was written — but never so soon that an
 * approver has no chance to answer.
 */
export function publishByFor(createdAt: Date, items: Item[] = []): string {
  const created = createdAt.getTime();
  const candidates = [created + DEFAULT_SHELF_LIFE_MS];
  for (const item of items) {
    const deadline = parseInstant(item.deadlineAt);
    if (deadline !== undefined) candidates.push(deadline - DEADLINE_LEAD_MS);
    const starts = parseInstant(item.startsAt);
    if (starts !== undefined) candidates.push(starts);
  }
  const earliest = Math.min(...candidates);
  return new Date(Math.max(earliest, created + MIN_SHELF_LIFE_MS)).toISOString();
}

/** A pending draft with its id, hash and expiry computed. Does not save it. */
export async function newDraft(input: NewDraftInput): Promise<Draft> {
  const { assignment, text, slides, photo, now, items } = input;
  const contentHash = await contentHashOf(
    text,
    slides.map((s) => s.path),
  );
  return {
    id: `${assignment.date}-${assignment.pillar}-${contentHash.slice(0, 6)}`,
    assignment,
    text,
    slides,
    ...(photo ? { photo } : {}),
    contentHash,
    createdAt: now.toISOString(),
    publishBy: publishByFor(now, items ?? []),
    status: "pending",
  };
}

const FILE_RE = /^(?!\.)(.+)\.json$/;

export function createDraftStore(dir: string): DraftStore {
  const fileFor = (id: string): string => join(dir, `${id}.json`);

  async function writeAtomic(draft: Draft): Promise<void> {
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${draft.id}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    try {
      await rename(temp, fileFor(draft.id));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async function read(id: string): Promise<Draft | undefined> {
    let raw: string;
    try {
      raw = await readFile(fileFor(id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    draftSchema.parse(parsed);
    return parsed as Draft;
  }

  return {
    async save(draft: Draft): Promise<void> {
      await writeAtomic(draft);
    },

    get: read,

    async list(filter): Promise<Draft[]> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const wanted =
        filter?.status === undefined
          ? undefined
          : new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
      const drafts: Draft[] = [];
      for (const name of names.sort()) {
        const match = FILE_RE.exec(name);
        if (!match?.[1]) continue;
        const draft = await read(match[1]);
        if (!draft) continue;
        if (wanted && !wanted.has(draft.status)) continue;
        drafts.push(draft);
      }
      return drafts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    },

    async transition(id, from, to, patch): Promise<Draft> {
      const draft = await read(id);
      if (!draft) throw new DraftNotFoundError(id);
      if (draft.status !== from || !TRANSITIONS[from].includes(to)) {
        throw new IllegalTransitionError(id, from, to, draft.status);
      }
      const updated: Draft = { ...draft, ...patch, id: draft.id, status: to };
      await writeAtomic(updated);
      return updated;
    },
  };
}
