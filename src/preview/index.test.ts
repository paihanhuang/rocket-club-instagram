import { describe, expect, it } from "vitest";
import type { Draft } from "../newsroom/types.js";
import { renderPreview } from "./index.js";

const draft: Draft = {
  id: "2026-09-28-launches-abc123",
  assignment: { date: "2026-09-28", pillar: "launches", angle: "how to watch from the Bay Area" },
  text: {
    headline: "Falcon 9 flies Tuesday <night>",
    slides: [{ title: "Cover", body: "Watch it live." }, { title: "Next step", body: "Set a reminder." }],
    caption: "Falcon 9 flies Tuesday.\n\nSet a reminder.\n\nSource: Launch Library.",
    sourceLine: "Source: Launch Library.",
    hashtags: ["rocketry", "lahs", "bayarea", "spacex", "falcon9"],
    flags: ["confirm before posting: window may shift"],
  },
  slides: [{ path: "/tmp/slide-01.jpg", width: 1080, height: 1350 }],
  contentHash: "abc123" + "0".repeat(58),
  createdAt: "2026-09-28T03:30:00.000Z",
  publishBy: "2026-09-29T18:59:59.000Z",
  status: "expired",
};

describe("renderPreview", () => {
  const html = renderPreview({
    generatedAt: "2026-09-28T04:00:00.000Z",
    handle: "@lahsrocketry",
    entries: [{ draft, slides: ["data:image/jpeg;base64,/9j/4AAQ"], seconds: 72.5 }],
    runs: [{ date: "2026-09-28", pillar: "launches", seconds: 72.5, ok: true, draftId: draft.id }],
  });

  it("shows each draft's pillar, headline, slides, caption, flags and timing", () => {
    expect(html).toContain("launches");
    expect(html).toContain("Falcon 9 flies Tuesday");
    expect(html).toContain('src="data:image/jpeg;base64,/9j/4AAQ"');
    expect(html).toContain("Source: Launch Library.");
    expect(html).toContain("confirm before posting: window may shift");
    expect(html).toContain("#rocketry");
    expect(html).toMatch(/72\.5|73/);
  });

  it("escapes model text so a draft cannot inject markup into the review page", () => {
    expect(html).not.toContain("<night>");
    expect(html).toContain("&lt;night&gt;");
  });

  it("carries a title and theme tokens on the root, as the page contract requires", () => {
    expect(html).toMatch(/<title>[^<]{3,60}<\/title>/);
    expect(html).toContain(":root");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain('[data-theme="dark"]');
  });
});
