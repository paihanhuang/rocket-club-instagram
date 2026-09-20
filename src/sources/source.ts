/**
 * What a source is. A leaf module on purpose: the registry and every source
 * adapter import this, so nothing here may import them back.
 */
import { createHash } from "node:crypto";
import type { Item } from "../newsroom/types.js";

export const HOUR_MS = 60 * 60 * 1000;

export type ParseContext = {
  /** When the body was actually fetched; may be older than `now` on a cache hit. */
  fetchedAt: string;
};

export type Source = {
  /** Short and stable: it is half of every Item id, so changing it renames items. */
  name: string;
  url: string;
  /** How long a recorded response stays good enough to reuse. */
  ttlMs: number;
  parse(body: string, ctx: ParseContext): Item[];
};

/**
 * A deterministic id, so the same launch or article keeps the same id across
 * runs, across the cache, and across machines. `key` is the source's own
 * identifier when it has one (the Launch Library launch id), else the URL.
 */
export function itemId(source: string, key: string): string {
  return createHash("sha256").update(`${source}\n${key}`).digest("hex").slice(0, 16);
}
