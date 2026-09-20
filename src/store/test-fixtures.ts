/**
 * Draft fixtures shared by the store, runner and publisher tests. Not part of
 * the store's interface; nothing in `src/` outside a test imports this.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Assignment,
  Draft,
  DraftText,
  Item,
  LicensedPhoto,
  Slide,
} from "../newsroom/types.js";

export function sampleAssignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    date: "2026-09-26",
    pillar: "explainer",
    angle: "Who we are and what we launch",
    ...overrides,
  };
}

export function sampleText(overrides: Partial<DraftText> = {}): DraftText {
  return {
    headline: "Why rockets throttle down through max q",
    slides: [
      { title: "Max q", body: "The moment the air pushes hardest on the rocket." },
      { title: "Throttle down", body: "The engines ease off so the airframe is not overloaded." },
    ],
    caption:
      "Max q is the moment a rocket feels the hardest push from the air it is flying through, and the engines ease off to get through it.",
    sourceLine: "Source: NASA",
    hashtags: ["rocketry", "lahs", "losaltos", "stem", "spaceflight"],
    flags: [],
    ...overrides,
  };
}

export function samplePhoto(overrides: Partial<LicensedPhoto> = {}): LicensedPhoto {
  return {
    url: "https://images.nasa.gov/falcon.jpg",
    license: "public-domain",
    credit: "NASA",
    source: "nasa",
    path: "/photos/falcon.jpg",
    ...overrides,
  };
}

export function sampleItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "ll2-1",
    source: "launchlibrary",
    title: "Falcon 9 · Starlink",
    url: "https://example.test/launch/1",
    summary: "A Falcon 9 lifts off from Vandenberg.",
    fetchedAt: "2026-09-25T02:00:00.000Z",
    ...overrides,
  };
}

export function sampleSlides(count = 2, dir = "/out/2026-09-26"): Slide[] {
  return Array.from({ length: count }, (_, i) => ({
    path: join(dir, `slide-${i + 1}.jpg`),
    width: 1080,
    height: 1350,
  }));
}

/** Writes `count` small files that stand in for rendered slides. */
export async function writeSlideFiles(dir: string, count = 2): Promise<Slide[]> {
  await mkdir(dir, { recursive: true });
  const slides: Slide[] = [];
  for (let i = 0; i < count; i += 1) {
    const path = join(dir, `slide-${i + 1}.jpg`);
    await writeFile(path, Buffer.from([0xff, 0xd8, 0xff, 0xe0, i]));
    slides.push({ path, width: 1080, height: 1350 });
  }
  return slides;
}

/** A complete, schema-valid draft. Override anything a test cares about. */
export function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "2026-09-26-explainer-abc123",
    assignment: sampleAssignment(),
    text: sampleText(),
    slides: sampleSlides(),
    contentHash: "abc123def456",
    createdAt: "2026-09-25T03:30:00.000Z",
    publishBy: "2026-09-26T15:30:00.000Z",
    status: "pending",
    ...overrides,
  };
}
