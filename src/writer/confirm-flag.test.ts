import { describe, expect, it } from "vitest";
import type { Shortlist } from "../newsroom/types.js";
import { needsConfirmFlag } from "./normalize.js";

const empty = (pillar: Shortlist["assignment"]["pillar"]): Shortlist => ({
  assignment: { date: "2026-09-26", pillar, angle: "x" },
  items: [],
  notes: [],
});

describe("the bare confirm flag is owed only when a time-sensitive post lacks its times", () => {
  it("an explainer with nothing to source owes no flag", () => {
    expect(needsConfirmFlag(empty("explainer"))).toBe(false);
  });
  it("a club post owes no flag", () => {
    expect(needsConfirmFlag(empty("club"))).toBe(false);
  });
  it("a launches post with no launches to name owes one", () => {
    expect(needsConfirmFlag(empty("launches"))).toBe(true);
  });
  it("an opportunities post with no deadlines owes one", () => {
    expect(needsConfirmFlag(empty("opportunities"))).toBe(true);
  });
});
