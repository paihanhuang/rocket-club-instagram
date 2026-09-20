import { describe, expect, it } from "vitest";
import type { Assignment } from "../newsroom/types.js";
import { LOS_ALTOS, shortlist } from "./index.js";

describe("shortlist notes", () => {
  it("carries the notes the sources reported into the shortlist, ahead of its own", () => {
    const assignment: Assignment = { date: "2026-09-26", pillar: "explainer", angle: "welcome" };
    const out = shortlist([], assignment, { now: new Date("2026-09-25T03:30:00.000Z"), home: LOS_ALTOS, notes: ["served stale cache for spacenews"] });
    expect(out.notes[0]).toBe("served stale cache for spacenews");
  });
});
