/**
 * Tests for the shortlist module, through `shortlist` only. Hand-made items:
 * the point of these tests is the rules, not any source's response shape.
 */
import { describe, expect, it } from "vitest";
import type { Assignment, Item, Pillar } from "../newsroom/types.js";
import { LOS_ALTOS, shortlist } from "./index.js";

/** Wednesday 2026-09-23, noon in Los Altos (PDT, UTC-7). */
const NOW = new Date("2026-09-23T19:00:00Z");

const OPTS = { now: NOW, home: LOS_ALTOS };

function assignment(pillar: Pillar): Assignment {
  return { date: "2026-09-24", pillar, angle: "how to watch it live from the Bay Area" };
}

type TestItem = Item & { vehicle?: string; webcast?: { url: string } };

let counter = 0;
function item(over: Partial<TestItem> & { title: string }): TestItem {
  counter += 1;
  return {
    id: `item-${counter}`,
    source: "test",
    url: `https://example.test/${counter}`,
    summary: "",
    fetchedAt: NOW.toISOString(),
    ...over,
  };
}

/** Vandenberg SFB: 330-odd km down the coast, well inside the 500 km rule. */
const VANDENBERG = { name: "Space Launch Complex 4E, Vandenberg SFB, CA, USA", lat: 34.632, lon: -120.611 };
/** Cape Canaveral: the other side of the continent. */
const CAPE = { name: "SLC-40, Cape Canaveral SFS, FL, USA", lat: 28.562, lon: -80.577 };

describe("launches", () => {
  it("keeps only launches in the next seven days and counts what it dropped", () => {
    const items = [
      item({ title: "Falcon 9 | Starlink", startsAt: "2026-09-24T12:00:00Z" }),
      item({ title: "Electron | StriX", startsAt: "2026-09-30T12:00:00Z" }),
      item({ title: "Atlas V | USSF", startsAt: "2026-10-20T12:00:00Z" }),
      item({ title: "Vulcan | Peregrine", startsAt: "2026-09-20T12:00:00Z" }),
      item({ title: "Ariane 6 | no date" }),
    ];

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Falcon 9 | Starlink",
      "Electron | StriX",
    ]);
    expect(result.assignment).toEqual(assignment("launches"));
    expect(result.notes.some((n) => n.includes("3 of 5"))).toBe(true);
  });

  it("ranks a launch with a pad, a named vehicle and a webcast above a bare one", () => {
    const items = [
      item({ title: "Unknown Rocket | Mystery", startsAt: "2026-09-24T01:00:00Z" }),
      item({
        title: "Falcon 9 Block 5 | Starlink Group 15-27",
        startsAt: "2026-09-26T01:00:00Z",
        location: VANDENBERG,
        vehicle: "Falcon 9 Block 5",
        webcast: { url: "https://x.com/i/broadcasts/1" },
      }),
      item({ title: "Long March 2D | PIESAT", startsAt: "2026-09-25T01:00:00Z", location: CAPE }),
    ];

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Falcon 9 Block 5 | Starlink Group 15-27",
      "Long March 2D | PIESAT",
      "Unknown Rocket | Mystery",
    ]);
  });

  it("reads the vehicle out of the title when the source did not name one", () => {
    const items = [
      item({ title: "Mystery Rocket | Payload", startsAt: "2026-09-24T02:00:00Z" }),
      item({ title: "New Glenn | Escapade", startsAt: "2026-09-24T03:00:00Z" }),
    ];

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.items[0]?.title).toBe("New Glenn | Escapade");
  });

  it("breaks a tie by the soonest launch and keeps at most five", () => {
    const items = Array.from({ length: 7 }, (_, n) =>
      item({
        title: `Electron | Flight ${n}`,
        startsAt: new Date(NOW.getTime() + (7 - n) * 60 * 60_000).toISOString(),
      }),
    );

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.items).toHaveLength(5);
    expect(result.items.map((i) => i.title)).toEqual([
      "Electron | Flight 6",
      "Electron | Flight 5",
      "Electron | Flight 4",
      "Electron | Flight 3",
      "Electron | Flight 2",
    ]);
    expect(result.notes.some((n) => n.includes("5") && n.includes("7"))).toBe(true);
  });
});

describe("weekend", () => {
  // The coming weekend in Los Altos: Fri 2026-09-25 00:00 PDT (07:00Z) through
  // Sun 2026-09-27 23:59 PDT (2026-09-28 06:59Z).
  const local = (title: string, startsAt: string) =>
    item({ title: `Falcon 9 | ${title}`, startsAt, location: VANDENBERG });

  it("keeps a launch that is Saturday in UTC but Friday evening in Los Altos", () => {
    const items = [local("Friday evening", "2026-09-26T02:00:00Z")];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items.map((i) => i.title)).toContain("Falcon 9 | Friday evening");
  });

  it("keeps a launch that is Monday in UTC but Sunday night in Los Altos", () => {
    const items = [local("Sunday night", "2026-09-28T04:00:00Z")];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items.map((i) => i.title)).toContain("Falcon 9 | Sunday night");
  });

  it("drops a launch that is Friday in UTC but Thursday night in Los Altos", () => {
    const items = [
      local("Thursday night", "2026-09-25T05:00:00Z"),
      local("Saturday noon", "2026-09-26T19:00:00Z"),
      local("Saturday evening", "2026-09-27T02:00:00Z"),
    ];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items.map((i) => i.title)).not.toContain("Falcon 9 | Thursday night");
    expect(result.items).toHaveLength(2);
  });

  it("drops a launch further than 500 km from Los Altos, and one with no pad at all", () => {
    const items = [
      local("Vandenberg one", "2026-09-26T19:00:00Z"),
      local("Vandenberg two", "2026-09-27T19:00:00Z"),
      item({ title: "Falcon 9 | Cape", startsAt: "2026-09-26T20:00:00Z", location: CAPE }),
      item({ title: "Falcon 9 | Nowhere", startsAt: "2026-09-26T21:00:00Z" }),
    ];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Falcon 9 | Vandenberg one",
      "Falcon 9 | Vandenberg two",
    ]);
    expect(result.notes.some((n) => n.includes("500 km"))).toBe(true);
  });

  it("fills from the launches rule and says so when the weekend is quiet", () => {
    const items = [
      local("Vandenberg", "2026-09-26T19:00:00Z"),
      item({
        title: "Electron | Mahia",
        startsAt: "2026-09-24T12:00:00Z",
        location: { name: "Mahia, New Zealand", lat: -39.26, lon: 177.86 },
      }),
    ];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual(["Falcon 9 | Vandenberg", "Electron | Mahia"]);
    expect(result.notes).toContain("no local launches this weekend");
  });

  it("does not fill when the weekend already has two local launches", () => {
    const items = [
      local("Vandenberg one", "2026-09-26T19:00:00Z"),
      local("Vandenberg two", "2026-09-27T19:00:00Z"),
      item({ title: "Electron | Mahia", startsAt: "2026-09-24T12:00:00Z" }),
    ];

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items).toHaveLength(2);
    expect(result.notes).not.toContain("no local launches this weekend");
  });

  it("keeps at most five", () => {
    const items = Array.from({ length: 8 }, (_, n) =>
      local(`Flight ${n}`, new Date(Date.parse("2026-09-26T12:00:00Z") + n * 60_000).toISOString()),
    );

    const result = shortlist(items, assignment("weekend"), OPTS);

    expect(result.items).toHaveLength(5);
  });
});

describe("review", () => {
  const article = (title: string, source: string, publishedAt: string) =>
    item({ title, source, publishedAt });

  it("keeps only the last seven days", () => {
    const items = [
      article("Artemis II rolls out", "nasa", "2026-09-22T12:00:00Z"),
      article("Europa Clipper checks in", "nasa", "2026-09-17T12:00:00Z"),
      article("An old story", "spacenews", "2026-09-10T12:00:00Z"),
    ];

    const result = shortlist(items, assignment("review"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Artemis II rolls out",
      "Europa Clipper checks in",
    ]);
    expect(result.notes.some((n) => n.includes("1 of 3"))).toBe(true);
  });

  it("drops an undated article", () => {
    const items = [
      article("Dated", "nasa", "2026-09-22T12:00:00Z"),
      item({ title: "Undated", source: "spacenews" }),
    ];

    const result = shortlist(items, assignment("review"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual(["Dated"]);
  });

  it("dedupes titles that differ only in punctuation and case, preferring NASA", () => {
    const items = [
      article("Artemis II Rolls Out to the Pad!", "spacenews", "2026-09-22T18:00:00Z"),
      article("artemis ii rolls out to the pad", "nasa", "2026-09-22T09:00:00Z"),
      article("Vulcan flies again", "nasaspaceflight", "2026-09-21T09:00:00Z"),
    ];

    const result = shortlist(items, assignment("review"), OPTS);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((i) => i.source)).toContain("nasa");
    expect(result.items.map((i) => i.source)).not.toContain("spacenews");
    expect(result.notes.some((n) => n.toLowerCase().includes("duplicate"))).toBe(true);
  });

  it("treats titles that agree for sixty characters as the same story", () => {
    const long = "A very long headline about the same rocket launch that goes on";
    const items = [
      article(`${long} and ends here`, "spacenews", "2026-09-22T18:00:00Z"),
      article(`${long} and ends somewhere else entirely`, "nasa", "2026-09-22T09:00:00Z"),
    ];

    const result = shortlist(items, assignment("review"), OPTS);

    expect(result.items).toHaveLength(1);
  });

  it("keeps the six most recent", () => {
    const items = Array.from({ length: 9 }, (_, n) =>
      article(`Story ${n}`, "spacenews", new Date(NOW.getTime() - n * 60 * 60_000).toISOString()),
    );

    const result = shortlist(items, assignment("review"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Story 0",
      "Story 1",
      "Story 2",
      "Story 3",
      "Story 4",
      "Story 5",
    ]);
    expect(result.notes.some((n) => n.includes("6") && n.includes("9"))).toBe(true);
  });
});

describe("opportunities", () => {
  it("keeps only deadlines more than two days away, soonest first, at most four", () => {
    const items = [
      item({ title: "Closes tomorrow", deadlineAt: "2026-09-24T19:00:00Z" }),
      item({ title: "Closes in three days", deadlineAt: "2026-09-26T19:00:00Z" }),
      item({ title: "Closes in a week", deadlineAt: "2026-09-30T19:00:00Z" }),
      item({ title: "Closes in a month", deadlineAt: "2026-10-23T19:00:00Z" }),
      item({ title: "Closes in a year", deadlineAt: "2027-09-23T19:00:00Z" }),
      item({ title: "Closes in two years", deadlineAt: "2028-09-23T19:00:00Z" }),
      item({ title: "No deadline at all" }),
    ];

    const result = shortlist(items, assignment("opportunities"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Closes in three days",
      "Closes in a week",
      "Closes in a month",
      "Closes in a year",
    ]);
    expect(result.notes.some((n) => n.includes("2 of 7"))).toBe(true);
  });
});

describe("neighbors", () => {
  it("keeps the four most recent", () => {
    const items = Array.from({ length: 6 }, (_, n) =>
      item({ title: `Neighbor ${n}`, publishedAt: new Date(NOW.getTime() - n * 86_400_000).toISOString() }),
    );

    const result = shortlist(items, assignment("neighbors"), OPTS);

    expect(result.items.map((i) => i.title)).toEqual([
      "Neighbor 0",
      "Neighbor 1",
      "Neighbor 2",
      "Neighbor 3",
    ]);
    expect(result.notes.some((n) => n.includes("4") && n.includes("6"))).toBe(true);
  });
});

describe("explainer and club", () => {
  it("passes everything through untouched and drops nothing", () => {
    const items = [
      item({ title: "A history of the Saturn V" }),
      item({ title: "Build night photos" }),
    ];

    for (const pillar of ["explainer", "club"] as const) {
      const result = shortlist(items, assignment(pillar), OPTS);
      expect(result.items).toEqual(items);
      expect(result.notes).toEqual([]);
    }
  });
});

describe("notes", () => {
  it("carries over the notes the sources attached to the items", () => {
    const items = Object.assign(
      [item({ title: "Falcon 9 | Starlink", startsAt: "2026-09-24T12:00:00Z" })],
      { notes: ["sources: launchlibrary is stale — served the cache recorded 2026-09-22T00:00:00Z"] },
    );

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.notes[0]).toContain("launchlibrary is stale");
  });

  it("says nothing when a rule dropped nothing", () => {
    const items = [item({ title: "Falcon 9 | Starlink", startsAt: "2026-09-24T12:00:00Z" })];

    const result = shortlist(items, assignment("launches"), OPTS);

    expect(result.notes).toEqual([]);
  });
});
