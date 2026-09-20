import { describe, expect, it } from "vitest";
import type { Draft } from "../newsroom/types.js";
import { next, resume } from "./machine.js";

const now = new Date("2026-09-26T23:10:00.000Z");
const draft: Draft = {
  id: "2026-09-26-explainer-abcdef",
  assignment: { date: "2026-09-26", pillar: "explainer", angle: "welcome" },
  text: {
    headline: "We build rockets",
    slides: [{ title: "We build rockets", body: "From Los Altos." }],
    caption: "We build rockets.\n\nSource: LAHS Rocket Club.",
    sourceLine: "Source: LAHS Rocket Club.",
    hashtags: ["rocketry", "lahs", "bayarea", "stem", "space"],
    flags: [],
  },
  slides: [{ path: "/tmp/slide-01.jpg", width: 1080, height: 1350 }],
  contentHash: "abcdef123456" + "0".repeat(52),
  createdAt: "2026-09-25T03:30:00.000Z",
  publishBy: "2026-09-27T18:59:59.000Z",
  status: "publishing",
  publish: { imageUrls: ["https://host/1.jpg"], containerIds: ["container-1"] },
};

describe("resuming a single-slide draft after a crash", () => {
  it("checks the recorded container before publishing it again", () => {
    const step = next(resume(draft, now), { type: "begin" });
    expect(step.commands.map((c) => c.type)).not.toContain("publish");
    expect(step.commands).toContainEqual({ type: "pollContainer", id: "container-1" });
  });

  it("treats an already published container as published, without a second publish", () => {
    const checking = next(resume(draft, now), { type: "begin" }).state;
    const done = next(checking, { type: "status", status: "PUBLISHED" });
    const types = done.commands.map((c) => c.type);
    expect(types).toContain("markPublished");
    expect(types).not.toContain("publish");
  });

  it("publishes a container that finished but was never published", () => {
    const checking = next(resume(draft, now), { type: "begin" }).state;
    const go = next(checking, { type: "status", status: "FINISHED" });
    expect(go.commands).toContainEqual({ type: "publish", containerId: "container-1" });
  });
});
