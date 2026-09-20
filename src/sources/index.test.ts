/**
 * Tests for the sources module, through `fetchItems` only. Every test replays
 * the fixtures recorded by `tests/fixtures/record.ts`; none touches the network.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeFetch } from "../../tests/fixtures/fake-fetch.js";
import { fetchItems } from "./index.js";

const LL2 = "ll.thespacedevs.com/2.3.0/launches/upcoming";
const NASA = "www.nasa.gov/news-release/feed";
const SPACENEWS = "spacenews.com/feed";
const NSF = "www.nasaspaceflight.com/feed";

const launchLibraryRoute = { match: LL2, fixture: "launchlibrary-upcoming.json" };
const feedRoutes = [
  { match: NASA, fixture: "rss-nasa.xml" },
  { match: SPACENEWS, fixture: "rss-spacenews.xml" },
  { match: NSF, fixture: "rss-nasaspaceflight.xml" },
];

/** The day the fixtures were recorded, so their windows are still upcoming. */
const NOW = new Date("2026-09-19T12:00:00Z");

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "newsroom-sources-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("launches", () => {
  it("maps a Launch Library launch onto an Item", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    const { items, notes } = await fetchItems("launches", { now: NOW, fetch, cacheDir });

    expect(items).toHaveLength(8);
    const starlink = items.find((i) => i.title.includes("Starlink Group 15-27"));
    expect(starlink).toBeDefined();
    expect(starlink?.source).toBe("launchlibrary");
    expect(starlink?.startsAt).toBe("2026-09-20T01:47:00.000Z");
    expect(starlink?.summary).toContain("Starlink");
    // The public page from the launch's info_urls, not the API URL.
    expect(starlink?.url).toBe("https://www.spacex.com/launches/sl-15-27");
    expect(starlink?.location).toEqual({
      name: "Space Launch Complex 4E, Vandenberg SFB, CA, USA",
      lat: 34.632,
      lon: -120.611,
    });
    expect(starlink?.fetchedAt).toBe(NOW.toISOString());
  });

  it("carries the launch image with its license and credit", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    const { items, notes } = await fetchItems("launches", { now: NOW, fetch, cacheDir });

    const starlink = items.find((i) => i.title.includes("Starlink Group 15-27"));
    expect(starlink?.images).toHaveLength(1);
    const image = starlink?.images?.[0];
    expect(image?.url).toMatch(/^https:\/\/.*\.(jpeg|jpg|png)$/);
    expect(image?.license).toBe("CC BY-NC 2.0");
    expect(image?.credit).toBe("SpaceX");
    expect(image?.source).toBe("launchlibrary");
  });

  it("falls back to the Launch Library site when a launch has no public page", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    const { items, notes } = await fetchItems("launches", { now: NOW, fetch, cacheDir });

    const longMarch = items.find((i) => i.title.includes("PIESAT-2 13-16"));
    expect(longMarch?.url).toBe("https://ll.thespacedevs.com");
  });

  it("gives every launch a distinct, deterministic id even without a public page", async () => {
    const { items: first } = await fetchItems("launches", {
      now: NOW,
      fetch: fakeFetch([launchLibraryRoute]),
      cacheDir,
    });
    const { items: second } = await fetchItems("launches", {
      now: new Date("2026-09-19T13:00:00Z"),
      fetch: fakeFetch([launchLibraryRoute]),
      cacheDir: await mkdtemp(join(tmpdir(), "newsroom-sources-")),
    });

    const ids = first.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[0-9a-f]{16}$/.test(id))).toBe(true);
    // Same launches, different hour, different cache: the same ids.
    expect(second.map((i) => i.id)).toEqual(ids);
  });

  it("asks Launch Library for the smallest page that carries what it maps", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    await fetchItems("launches", { now: NOW, fetch, cacheDir });

    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]).toBe(
      "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=detailed",
    );
  });
});

describe("weekend", () => {
  it("reads the same upcoming launches as the launches pillar", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    const { items: launches } = await fetchItems("launches", { now: NOW, fetch, cacheDir });
    const { items: weekend } = await fetchItems("weekend", { now: NOW, fetch, cacheDir });

    expect(weekend.map((i) => i.id)).toEqual(launches.map((i) => i.id));
    // The second pillar is served from the cache Launch Library's rate limit needs.
    expect(fetch.countOf(LL2)).toBe(1);
  });
});

describe("pillars with no sourcing", () => {
  it("returns nothing and asks nothing for explainer and club", async () => {
    const fetch = fakeFetch([]);
    expect(await fetchItems("explainer", { now: NOW, fetch, cacheDir })).toEqual({ items: [], notes: [] });
    expect(await fetchItems("club", { now: NOW, fetch, cacheDir })).toEqual({ items: [], notes: [] });
    expect(fetch.calls).toHaveLength(0);
  });

  it("returns nothing for opportunities and neighbors until their sources are wired", async () => {
    const fetch = fakeFetch([]);
    const { items: opportunities } = await fetchItems("opportunities", { now: NOW, fetch, cacheDir });
    const { items: neighbors } = await fetchItems("neighbors", { now: NOW, fetch, cacheDir });

    expect(opportunities).toEqual([]);
    expect(neighbors).toEqual([]);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("review", () => {
  it("reads all three feeds and dates every item", async () => {
    const fetch = fakeFetch(feedRoutes);
    const { items, notes } = await fetchItems("review", { now: NOW, fetch, cacheDir });

    expect(fetch.calls).toHaveLength(3);
    expect(items).toHaveLength(18);
    expect(new Set(items.map((i) => i.source))).toEqual(
      new Set(["nasa", "spacenews", "nasaspaceflight"]),
    );
    for (const item of items) {
      expect(item.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.title.length).toBeGreaterThan(0);
    }
    expect(notes).toEqual([]);
  });

  it("decodes entities and strips markup out of a feed entry", async () => {
    const fetch = fakeFetch(feedRoutes);
    const { items, notes } = await fetchItems("review", { now: NOW, fetch, cacheDir });

    const promotion = items.find((i) => i.title.includes("Terran Orbital Promotes"));
    expect(promotion?.title).toContain("European Operations & Head");
    expect(promotion?.source).toBe("spacenews");
    expect(promotion?.publishedAt).toBe("2026-09-18T14:47:38.000Z");
    expect(promotion?.summary).not.toContain("<");
    expect(promotion?.summary).not.toContain("&#");
  });

  it("skips a dead feed, notes it, and keeps the rest", async () => {
    const fetch = fakeFetch([
      { match: NASA, throws: "getaddrinfo ENOTFOUND www.nasa.gov" },
      { match: SPACENEWS, fixture: "rss-spacenews.xml" },
      { match: NSF, fixture: "rss-nasaspaceflight.xml" },
    ]);
    const { items, notes } = await fetchItems("review", { now: NOW, fetch, cacheDir });

    expect(items).toHaveLength(12);
    expect(items.map((i) => i.source)).not.toContain("nasa");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("nasa");
  });

  it("treats a bad status as a dead feed", async () => {
    const fetch = fakeFetch([
      { match: NASA, fixture: "rss-nasa.xml" },
      { match: SPACENEWS, body: "upstream error", status: 503 },
      { match: NSF, fixture: "rss-nasaspaceflight.xml" },
    ]);
    const { items, notes } = await fetchItems("review", { now: NOW, fetch, cacheDir });

    expect(items).toHaveLength(12);
    expect(notes[0]).toContain("503");
  });

  it("throws only when every feed fails", async () => {
    const fetch = fakeFetch([
      { match: NASA, throws: "dead" },
      { match: SPACENEWS, throws: "dead" },
      { match: NSF, throws: "dead" },
    ]);

    await expect(fetchItems("review", { now: NOW, fetch, cacheDir })).rejects.toThrow(/review/);
  });
});

describe("the disk cache", () => {
  it("serves a fresh Launch Library response without asking again", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    const { items: first } = await fetchItems("launches", { now: NOW, fetch, cacheDir });
    const later = new Date(NOW.getTime() + 5 * 60 * 60_000 + 59 * 60_000);
    const { items: second } = await fetchItems("launches", { now: later, fetch, cacheDir });

    expect(fetch.countOf(LL2)).toBe(1);
    expect(second.map((i) => i.id)).toEqual(first.map((i) => i.id));
    // The item still says when the data was actually fetched.
    expect(second[0]?.fetchedAt).toBe(NOW.toISOString());
  });

  it("asks Launch Library again once the cache is over six hours old", async () => {
    const fetch = fakeFetch([launchLibraryRoute]);
    await fetchItems("launches", { now: NOW, fetch, cacheDir });
    const later = new Date(NOW.getTime() + 6 * 60 * 60_000 + 60_000);
    await fetchItems("launches", { now: later, fetch, cacheDir });

    expect(fetch.countOf(LL2)).toBe(2);
  });

  it("keeps a feed for two hours, then asks again", async () => {
    const fetch = fakeFetch(feedRoutes);
    await fetchItems("review", { now: NOW, fetch, cacheDir });

    const withinTtl = new Date(NOW.getTime() + 119 * 60_000);
    await fetchItems("review", { now: withinTtl, fetch, cacheDir });
    expect(fetch.calls).toHaveLength(3);

    const pastTtl = new Date(NOW.getTime() + 121 * 60_000);
    await fetchItems("review", { now: pastTtl, fetch, cacheDir });
    expect(fetch.calls).toHaveLength(6);
  });

  it("serves a stale cache when the fetch fails, and says so in a note", async () => {
    const working = fakeFetch([launchLibraryRoute]);
    await fetchItems("launches", { now: NOW, fetch: working, cacheDir });

    const broken = fakeFetch([{ match: LL2, throws: "connect ETIMEDOUT" }]);
    const muchLater = new Date(NOW.getTime() + 24 * 60 * 60_000);
    const { items, notes } = await fetchItems("launches", { now: muchLater, fetch: broken, cacheDir });

    expect(items).toHaveLength(8);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/stale/i);
    expect(notes[0]).toContain(NOW.toISOString());
  });

  it("does not keep a response it cannot read", async () => {
    const nonsense = fakeFetch([{ match: LL2, body: "<html>too many requests</html>" }]);
    await expect(fetchItems("launches", { now: NOW, fetch: nonsense, cacheDir })).rejects.toThrow();

    // Nothing was cached, so the next run goes back to the network and recovers.
    const working = fakeFetch([launchLibraryRoute]);
    const { items, notes } = await fetchItems("launches", { now: NOW, fetch: working, cacheDir });

    expect(working.countOf(LL2)).toBe(1);
    expect(items).toHaveLength(8);
  });

  it("throws when Launch Library fails and nothing was ever cached", async () => {
    const fetch = fakeFetch([{ match: LL2, throws: "connect ETIMEDOUT" }]);

    await expect(fetchItems("launches", { now: NOW, fetch, cacheDir })).rejects.toThrow(/launches/);
  });
});
