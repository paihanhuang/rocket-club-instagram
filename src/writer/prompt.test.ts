import { describe, expect, it } from "vitest";
import type { Assignment, Item, LicensedPhoto, Shortlist } from "../newsroom/types.js";
import { assemblePrompt, CAPTION_STRUCTURE, JSON_ONLY, PILLAR_NOTES, renderItem, SUMMARY_MAX } from "./prompt.js";

const guides = {
  voice: "# Voice guide\nYou write as the LAHS Rocket Club: the classmate who is really into rockets.\n",
  fence: "# Fence\n1. A human approves every post.\n8. Every caption carries a source line.\n",
};

const assignment: Assignment = {
  date: "2026-09-28",
  pillar: "launches",
  angle: "how to watch it live from the Bay Area",
};

const BASE_ITEM: Item = {
  id: "ll-1",
  source: "Launch Library",
  title: "Falcon 9 · Starlink Group 11-24",
  url: "https://example.org/launch/1",
  summary: "A Falcon 9 lifts 28 Starlink satellites from Vandenberg.",
  startsAt: "2026-09-29T18:10:00-07:00",
  location: { name: "Vandenberg SFB, SLC-4E", lat: 34.63, lon: -120.61 },
  fetchedAt: "2026-09-27T08:00:00-07:00",
};

/** An override of `undefined` means the real item simply lacks that field. */
type ItemOverrides = { [K in keyof Item]?: Item[K] | undefined };

const item = (over: ItemOverrides = {}): Item => {
  const merged: Record<string, unknown> = { ...BASE_ITEM, ...over };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as Item;
};

const shortlist = (items: Item[], over: Partial<Assignment> = {}): Shortlist => ({
  assignment: { ...assignment, ...over },
  items,
  notes: ["ranked by distance"],
});

const photo: LicensedPhoto = {
  url: "https://images.nasa.gov/a.jpg",
  license: "public domain",
  credit: "NASA",
  source: "NASA",
  path: "/tmp/a.jpg",
};

describe("assemblePrompt: system", () => {
  it("carries the voice guide, the fence, the pillar note and the JSON instruction, in that order", () => {
    const { system } = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });

    expect(system).toContain("You write as the LAHS Rocket Club");
    expect(system).toContain("Every caption carries a source line.");
    expect(system).toContain(PILLAR_NOTES.launches);
    expect(system.endsWith(JSON_ONLY)).toBe(true);

    expect(system.indexOf("You write as the LAHS Rocket Club")).toBeLessThan(system.indexOf("A human approves"));
    expect(system.indexOf("A human approves")).toBeLessThan(system.indexOf(PILLAR_NOTES.launches));
  });

  it("uses the note for the assignment's own pillar", () => {
    const { system } = assemblePrompt({
      assignment: { ...assignment, pillar: "opportunities" },
      shortlist: shortlist([item()], { pillar: "opportunities" }),
      guides,
    });

    expect(system).toContain(PILLAR_NOTES.opportunities);
    expect(system).not.toContain(PILLAR_NOTES.launches);
  });
});

describe("assemblePrompt: user", () => {
  it("states the assignment", () => {
    const { user } = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });

    expect(user).toContain("date: 2026-09-28");
    expect(user).toContain("pillar: launches");
    expect(user).toContain("angle: how to watch it live from the Bay Area");
  });

  it("renders every shortlist item compactly", () => {
    const items = [
      item(),
      item({
        id: "ll-2",
        title: "Electron · Synspective StriX-9",
        startsAt: "2026-09-30T02:15:00-07:00",
        location: { name: "Mahia, New Zealand", lat: -39.26, lon: 177.86 },
        url: "https://example.org/launch/2",
      }),
    ];
    const { user } = assemblePrompt({ assignment, shortlist: shortlist(items), guides });

    expect(user).toContain("# Shortlist (2 items)");
    expect(user).toContain("[1] Falcon 9 · Starlink Group 11-24");
    expect(user).toContain("    startsAt: Tue Sep 29, 6:10 PM PT (2026-09-29T18:10:00-07:00)");
    expect(user).toContain("    location: Vandenberg SFB, SLC-4E");
    expect(user).toContain("    url: https://example.org/launch/1");
    expect(user).toContain("    summary: A Falcon 9 lifts 28 Starlink satellites from Vandenberg.");
    expect(user).toContain("[2] Electron · Synspective StriX-9");
    expect(user).toContain("    url: https://example.org/launch/2");
  });

  it("renders a deadline when the item has one, and omits fields the item lacks", () => {
    const rendered = renderItem(
      item({ startsAt: undefined, deadlineAt: "2026-10-03T23:59:00-07:00", location: undefined }),
      0,
    );

    expect(rendered).toContain("    deadlineAt: Sat Oct 3, 11:59 PM PT (2026-10-03T23:59:00-07:00)");
    expect(rendered).not.toContain("startsAt:");
    expect(rendered).not.toContain("location:");
  });

  it("trims a long summary to 300 characters", () => {
    const long = "x".repeat(900);
    const rendered = renderItem(item({ summary: long }), 0);
    const summary = rendered.split("summary: ")[1] ?? "";

    expect(summary.length).toBe(SUMMARY_MAX);
    expect(summary.endsWith("…")).toBe(true);
    expect(rendered).not.toContain(long);
  });

  it("says a licensed photo is coming, only when one is given", () => {
    const withPhoto = assemblePrompt({ assignment, shortlist: shortlist([item()]), photo, guides });
    const without = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });

    expect(withPhoto.user).toContain(
      "A licensed photo from NASA will appear on the cover; mention nothing about it in the caption.",
    );
    expect(without.user).not.toContain("licensed photo");
  });

  it("says the shortlist is empty rather than pretending it has material", () => {
    const { user } = assemblePrompt({ assignment, shortlist: shortlist([]), guides });

    expect(user).toContain("# Shortlist (0 items)");
    expect(user).toContain("do not invent any");
  });

  it("spells out the required caption structure", () => {
    const { user } = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });

    expect(user).toContain(CAPTION_STRUCTURE);
    expect(user).toContain("1. Hook:");
    expect(user).toContain("4. Source line:");
  });
});

describe("assemblePrompt: jsonSchema", () => {
  it("is the draft contract, with its six properties", () => {
    const { jsonSchema } = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });
    const properties = jsonSchema["properties"] as Record<string, unknown>;

    expect(jsonSchema["type"]).toBe("object");
    expect(Object.keys(properties).sort()).toEqual(
      ["caption", "flags", "hashtags", "headline", "slides", "sourceLine"].sort(),
    );
    expect(jsonSchema["required"]).toEqual(
      expect.arrayContaining(["headline", "slides", "caption", "sourceLine", "hashtags", "flags"]),
    );
  });

  it("keeps the limits the schema sets, so the harness can enforce them", () => {
    const { jsonSchema } = assemblePrompt({ assignment, shortlist: shortlist([item()]), guides });
    const properties = jsonSchema["properties"] as Record<string, Record<string, unknown>>;

    expect(properties["slides"]?.["maxItems"]).toBe(10);
    expect(properties["hashtags"]?.["minItems"]).toBe(5);
    expect(properties["hashtags"]?.["maxItems"]).toBe(8);
  });
});
