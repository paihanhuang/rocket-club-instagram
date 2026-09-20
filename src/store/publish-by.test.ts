import { describe, expect, it } from "vitest";
import type { Item } from "../newsroom/types.js";
import { publishByFor } from "./index.js";

// Fri Sep 24 2026, 8:30pm PDT: the evening run that drafts Saturday's post.
const created = new Date("2026-09-25T03:30:00.000Z");
const item = (patch: Partial<Item>): Item => ({
  id: "x",
  source: "test",
  title: "t",
  url: "https://example.test",
  summary: "",
  fetchedAt: created.toISOString(),
  ...patch,
});

describe("publishByFor: a draft is useful until the morning after its assignment date", () => {
  it("defaults to 11:59:59am PT on the day after the assignment", () => {
    expect(publishByFor(created, [], "2026-09-26")).toBe("2026-09-27T18:59:59.000Z");
  });

  it("is anchored to the assignment date, not to when the draft was made", () => {
    expect(publishByFor(created, [], "2026-10-02")).toBe("2026-10-03T18:59:59.000Z");
  });

  it("posts a launch before it happens", () => {
    const by = publishByFor(created, [item({ startsAt: "2026-09-26T16:00:00.000Z" })], "2026-09-26");
    expect(by).toBe("2026-09-26T16:00:00.000Z");
  });

  it("gives an opportunity deadline a day of room", () => {
    const by = publishByFor(created, [item({ deadlineAt: "2026-09-27T06:59:00.000Z" })], "2026-09-26");
    expect(by).toBe("2026-09-26T06:59:00.000Z");
  });

  it("expires at the launch even when the launch is minutes away, rather than after it", () => {
    const by = publishByFor(created, [item({ startsAt: "2026-09-25T03:40:00.000Z" })], "2026-09-26");
    expect(by).toBe("2026-09-25T03:40:00.000Z");
  });

  it("uses standard time after the November change", () => {
    // Nov 3 2026 is PST (UTC-8): 11:59:59am is 19:59:59Z.
    expect(publishByFor(new Date("2026-11-02T04:00:00.000Z"), [], "2026-11-02")).toBe("2026-11-03T19:59:59.000Z");
  });
});
