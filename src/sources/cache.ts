/**
 * The disk cache: one JSON file per source URL, holding the response body and
 * the moment it was fetched. It exists for Launch Library's 15-requests-an-hour
 * limit first and for offline runs second, so a stale entry is kept, never
 * deleted: a day-old launch list beats no launch list.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type CacheEntry = {
  url: string;
  source: string;
  /** ISO 8601. The age of the body, not of the file. */
  fetchedAt: string;
  body: string;
};

function fileFor(cacheDir: string, source: string, url: string): string {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return join(cacheDir, `${source}-${digest}.json`);
}

/** Undefined when nothing is cached or the file is unreadable; a bad cache is not an error. */
export async function readCacheEntry(
  cacheDir: string,
  source: string,
  url: string,
): Promise<CacheEntry | undefined> {
  try {
    const raw = await readFile(fileFor(cacheDir, source, url), "utf8");
    const entry = JSON.parse(raw) as Partial<CacheEntry>;
    if (typeof entry.body !== "string" || typeof entry.fetchedAt !== "string") return undefined;
    return { url, source, fetchedAt: entry.fetchedAt, body: entry.body };
  } catch {
    return undefined;
  }
}

/** Written through a temporary file, so an interrupted run never leaves half a cache. */
export async function writeCacheEntry(cacheDir: string, entry: CacheEntry): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const target = fileFor(cacheDir, entry.source, entry.url);
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(entry), "utf8");
  await rename(temp, target);
}

export function isFresh(entry: CacheEntry, now: Date, ttlMs: number): boolean {
  const fetchedAt = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAt)) return false;
  const age = now.getTime() - fetchedAt;
  return age >= 0 && age <= ttlMs;
}
