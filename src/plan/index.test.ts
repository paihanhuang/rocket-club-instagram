import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ANGLES, isoWeekFile, parsePlan, readAssignment } from "./index.js";
import { isoWeekOf } from "../newsroom/time.js";

async function planDirWith(name: string, markdown: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "plan-"));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), markdown, "utf8");
  return dir;
}

describe("isoWeekFile", () => {
  it("names the ISO week a day belongs to", () => {
    // 2026-09-26 is a Saturday in ISO week 39 of 2026.
    expect(isoWeekFile("2026-09-26")).toBe("2026-W39.md");
    expect(isoWeekFile("2026-09-21")).toBe("2026-W39.md"); // Monday of the same week
    expect(isoWeekFile("2026-09-20")).toBe("2026-W38.md"); // Sunday closes the week before
  });

  it("uses the ISO week-numbering year, not the calendar year", () => {
    // 2027-01-01 is a Friday, so it belongs to the last week of 2026.
    expect(isoWeekFile("2027-01-01")).toBe("2026-W53.md");
    expect(isoWeekOf("2026-01-01")).toEqual({ year: 2026, week: 1 });
  });

  it("accepts an instant and reads it in Los Altos", () => {
    // 2026-09-27T05:30Z is still Saturday the 26th in California.
    expect(isoWeekFile(new Date("2026-09-27T05:30:00Z"))).toBe("2026-W39.md");
  });
});

describe("parsePlan", () => {
  it("reads every assignment line and ignores the prose around them", () => {
    const markdown = [
      "# Week of September 21",
      "",
      "Notes for officers: the launch window slips a lot this week.",
      "",
      "- 2026-09-21 | launches | Starship flight 14, how to watch from the Bay Area",
      "* 2026-09-22 | opportunities | NASA internship deadline is Friday",
      "- 2026-09-23 | Explainer | Why rockets throttle down through max q",
      "",
      "- not an assignment",
      "- 2026-09-24 | nonsense | this pillar does not exist",
      "- 2026-09-25|weekend|Chabot star party Saturday night",
    ].join("\n");
    expect(parsePlan(markdown)).toEqual([
      {
        date: "2026-09-21",
        pillar: "launches",
        angle: "Starship flight 14, how to watch from the Bay Area",
      },
      {
        date: "2026-09-22",
        pillar: "opportunities",
        angle: "NASA internship deadline is Friday",
      },
      {
        date: "2026-09-23",
        pillar: "explainer",
        angle: "Why rockets throttle down through max q",
      },
      {
        date: "2026-09-25",
        pillar: "weekend",
        angle: "Chabot star party Saturday night",
      },
    ]);
  });

  it("returns nothing for a file with no assignments", () => {
    expect(parsePlan("# Empty week\n\nNothing planned.\n")).toEqual([]);
  });
});

describe("readAssignment", () => {
  it("takes the chief's line for the day", async () => {
    const dir = await planDirWith(
      "2026-W39.md",
      "- 2026-09-26 | explainer | Who we are and what we launch\n",
    );
    await expect(readAssignment("2026-09-26", dir)).resolves.toEqual({
      date: "2026-09-26",
      pillar: "explainer",
      angle: "Who we are and what we launch",
    });
  });

  it("falls back to the rhythm when the week has a file but not the day", async () => {
    const dir = await planDirWith(
      "2026-W39.md",
      "- 2026-09-25 | weekend | Chabot star party\n",
    );
    // 2026-09-26 is a Saturday, which the rhythm gives to club.
    await expect(readAssignment("2026-09-26", dir)).resolves.toEqual({
      date: "2026-09-26",
      pillar: "club",
      angle: DEFAULT_ANGLES.club,
    });
  });

  it("falls back to the rhythm when no plan file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "plan-empty-"));
    await expect(readAssignment("2026-09-21", dir)).resolves.toEqual({
      date: "2026-09-21",
      pillar: "launches",
      angle: DEFAULT_ANGLES.launches,
    });
    await expect(readAssignment("2026-09-27", dir)).resolves.toEqual({
      date: "2026-09-27",
      pillar: "review",
      angle: DEFAULT_ANGLES.review,
    });
  });

  it("reads an instant as the day it is in Los Altos", async () => {
    const dir = await planDirWith(
      "2026-W39.md",
      "- 2026-09-26 | explainer | Who we are and what we launch\n",
    );
    const assignment = await readAssignment(new Date("2026-09-27T05:30:00Z"), dir);
    expect(assignment.date).toBe("2026-09-26");
    expect(assignment.pillar).toBe("explainer");
  });
});
