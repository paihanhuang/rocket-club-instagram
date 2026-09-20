/**
 * sources: `fetchItems(pillar, opts)` — every piece of material a pillar can be
 * written from, already mapped onto the newsroom's `Item`.
 *
 * Behind the seam: which sources a pillar has (`registry.ts`), Launch Library
 * and RSS parsing, and a disk cache that keeps the newsroom inside Launch
 * Library's rate limit and standing up when a source is down.
 *
 * `fetch` is injected, so tests replay recorded fixtures and never reach the
 * network.
 */
import type { Fetch } from "../newsroom/ports.js";
import type { Item, Pillar } from "../newsroom/types.js";
import { type CacheEntry, isFresh, readCacheEntry, writeCacheEntry } from "./cache.js";
import { sourcesFor } from "./registry.js";
import type { Source } from "./source.js";

export type FetchItemsOptions = {
  now: Date;
  fetch: Fetch;
  /** Directory for the per-source response cache; created on first write. */
  cacheDir: string;
};

/** The items, and one line for every source that misbehaved (a dead feed, a stale cache). */
export type FetchedItems = { items: Item[]; notes: string[] };

/** A school club reading public feeds; say so. */
const USER_AGENT = "lahsrocketry-newsroom/0.1 (+https://github.com/lahsrocketry)";

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ACCEPT = "application/json, application/rss+xml, text/xml;q=0.9, */*;q=0.8";

type Loaded = { items: Item[]; staleSince?: string; staleReason?: string };

/**
 * Cache first while fresh, then the network, then the stale cache. Parsing
 * happens before the cache is written, so a rate-limit page or a truncated
 * feed is never kept in place of the real thing. Only a failure with nothing
 * cached at all throws.
 */
async function load(source: Source, opts: FetchItemsOptions): Promise<Loaded> {
  const cached = await readCacheEntry(opts.cacheDir, source.name, source.url);
  const reuse = (entry: CacheEntry) => source.parse(entry.body, { fetchedAt: entry.fetchedAt });

  if (cached && isFresh(cached, opts.now, source.ttlMs)) return { items: reuse(cached) };

  try {
    const res = await opts.fetch(source.url, {
      headers: { accept: ACCEPT, "user-agent": USER_AGENT },
    });
    if (!res.ok) throw new Error(`${source.url} → ${res.status} ${res.statusText}`.trimEnd());
    const body = await res.text();
    const fetchedAt = opts.now.toISOString();
    const items = source.parse(body, { fetchedAt });
    await writeCacheEntry(opts.cacheDir, { url: source.url, source: source.name, fetchedAt, body });
    return { items };
  } catch (error) {
    if (!cached) throw error;
    return { items: reuse(cached), staleSince: cached.fetchedAt, staleReason: reason(error) };
  }
}

export async function fetchItems(
  pillar: Pillar,
  opts: FetchItemsOptions,
): Promise<FetchedItems> {
  const sources = sourcesFor(pillar);
  if (sources.length === 0) return { items: [], notes: [] };

  const items: Item[] = [];
  const notes: string[] = [];
  const failures: string[] = [];

  for (const source of sources) {
    try {
      const loaded = await load(source, opts);
      if (loaded.staleSince) {
        notes.push(
          `sources: ${source.name} is stale — served the cache recorded ${loaded.staleSince} because the fetch failed (${loaded.staleReason})`,
        );
      }
      items.push(...loaded.items);
    } catch (error) {
      failures.push(`${source.name} (${reason(error)})`);
      notes.push(`sources: ${source.name} failed (${reason(error)}); skipped`);
    }
  }

  // One dead feed is a note; a pillar with nothing left to read is a failure.
  if (failures.length === sources.length) {
    throw new Error(`sources: every source for ${pillar} failed — ${failures.join("; ")}`);
  }

  return { items: items, notes: notes };
}

/** For the doctor, which probes every source without fetching a pillar. */
export { REGISTRY } from "./registry.js";
export type { Source } from "./source.js";
/** The optional extras the launches source attaches; the shortlist ranks on them. */
export type { LaunchItem, LaunchExtras } from "./launchlibrary.js";
