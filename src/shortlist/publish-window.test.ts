import { describe, expect, it } from "vitest";
import type { Assignment, Item } from "../newsroom/types.js";
import { LOS_ALTOS, shortlist } from "./index.js";

// Fri Sep 24 2026, 8:30pm PDT: the evening run that drafts Saturday's post.
const now = new Date("2026-09-25T03:30:00.000Z");
const item = (patch: Partial<Item>): Item => ({
  id: "x",
  source: "test",
  title: "Falcon 9 | Starlink",
  url: "https://example.test",
  summary: "",
  fetchedAt: now.toISOString(),
  ...patch,
});

describe("a post cannot announce something that already happened", () => {
  it("drops a launch that lifts off before the assignment day's publish window (3pm PT)", () => {
    const assignment: Assignment = { date: "2026-09-26", pillar: "launches", angle: "this week" };
    const morning = item({ id: "a", startsAt: "2026-09-26T16:00:00.000Z" }); // Sat 9:00am PDT
    const evening = item({ id: "b", title: "Electron | Owl", startsAt: "2026-09-27T01:00:00.000Z" }); // Sat 6:00pm PDT
    const out = shortlist([morning, evening], assignment, { now, home: LOS_ALTOS });
    expect(out.items.map((i) => i.id)).toEqual(["b"]);
    expect(out.notes.join(" ")).toMatch(/before the publish window/);
  });

  it("applies the same rule to the weekend pillar", () => {
    const assignment: Assignment = { date: "2026-09-26", pillar: "weekend", angle: "this weekend" };
    const vandenberg = { name: "Vandenberg SFB", lat: 34.7420, lon: -120.5724 };
    const morning = item({ id: "a", startsAt: "2026-09-26T16:00:00.000Z", location: vandenberg });
    const evening = item({ id: "b", startsAt: "2026-09-27T01:00:00.000Z", location: vandenberg });
    const sunday = item({ id: "c", startsAt: "2026-09-27T20:00:00.000Z", location: vandenberg });
    const out = shortlist([morning, evening, sunday], assignment, { now, home: LOS_ALTOS });
    expect(out.items.map((i) => i.id)).toEqual(["b", "c"]);
  });
});
