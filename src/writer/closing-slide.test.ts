import { describe, expect, it } from "vitest";
import type { Assignment, Shortlist } from "../newsroom/types.js";
import { normalizeDraft } from "./normalize.js";

const assignment: Assignment = { date: "2026-09-26", pillar: "explainer", angle: "welcome" };
const shortlist: Shortlist = { assignment, items: [], notes: [] };

describe("closing slide", () => {
  it("drops the handle the template already prints from slide bodies", () => {
    const out = normalizeDraft(
      {
        headline: "We build rockets",
        slides: [
          { title: "Cover", body: "We build rockets." },
          { title: "Next step", body: "Come to our next meeting; details in bio.\n@lahsrocketry" },
        ],
        caption: "We build rockets.\n\nSource: LAHS Rocket Club",
        sourceLine: "Source: LAHS Rocket Club",
        hashtags: ["rocketry", "lahs", "bayarea", "stem", "space"],
        flags: [],
      },
      { assignment, shortlist },
    ) as { slides: { title: string; body: string }[] };
    expect(out.slides[1]?.body).toBe("Come to our next meeting; details in bio.");
  });
});
