import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { Assignment, Item, LicensedPhoto, Pillar, Shortlist } from "../newsroom/types.js";
import {
  CONFIRM_FLAG,
  createWriter,
  DraftInvalidError,
  fakeGenerate,
  ModelUnavailableError,
  resolveModelChoice,
  writerWith,
} from "./index.js";

const guides = {
  voice: "# Voice guide\nYou write as the LAHS Rocket Club.\n",
  fence: "# Fence\nEvery caption carries a source line.\n",
};

const GUIDES_DIR = fileURLToPath(new URL("../../guides", import.meta.url));

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
  fetchedAt: "2026-09-27T08:00:00-07:00",
};

/** An override of `undefined` means the real item simply lacks that field. */
type ItemOverrides = { [K in keyof Item]?: Item[K] | undefined };

const item = (over: ItemOverrides = {}): Item => {
  const merged: Record<string, unknown> = { ...BASE_ITEM, ...over };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged as Item;
};

const shortlist = (items: Item[], pillar: Pillar = "launches"): Shortlist => ({
  assignment: { ...assignment, pillar },
  items,
  notes: [],
});

const sourceLine = "Source: Launch Library, SpaceX.";

const goodDraft = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  headline: "Falcon 9 flies Monday night",
  slides: [{ title: "Falcon 9 flies Monday night", body: "Vandenberg, 6:10pm PT, visible from Los Altos." }],
  caption: `A Falcon 9 lifts off Tue Sep 29, 6:10pm PT from Vandenberg.\n\nWatch it live on the SpaceX stream.\n\n${sourceLine}`,
  sourceLine,
  hashtags: ["rocketry", "lahs", "spacenews", "bayarea", "falcon9"],
  flags: [],
  ...over,
});

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function guidesDirWith(voice: string, fence: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "lahs-guides-"));
  temps.push(dir);
  await writeFile(join(dir, "voice.md"), voice, "utf8");
  await writeFile(join(dir, "fence.md"), fence, "utf8");
  return dir;
}

describe("writeDraft: the happy path", () => {
  it("returns the model's draft once it satisfies the schema", async () => {
    const fake = fakeGenerate([goodDraft()]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.headline).toBe("Falcon 9 flies Monday night");
    expect(draft.caption).toContain(sourceLine);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.wallTimeMs).toBe(300_000);
  });

  it("asks with the assembled prompt, including the photo note", async () => {
    const photo: LicensedPhoto = {
      url: "https://images.nasa.gov/a.jpg",
      license: "public domain",
      credit: "NASA",
      source: "NASA",
      path: "/tmp/a.jpg",
    };
    const fake = fakeGenerate([goodDraft()]);
    await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]), photo);

    expect(fake.calls[0]?.system).toContain("You write as the LAHS Rocket Club.");
    expect(fake.calls[0]?.user).toContain("[1] Falcon 9 · Starlink Group 11-24");
    expect(fake.calls[0]?.user).toContain("A licensed photo from NASA will appear on the cover");
  });

  it("honours a wall time the caller sets", async () => {
    const fake = fakeGenerate([goodDraft()]);
    await writerWith(fake, { guides, wallTimeMs: 1234 }).writeDraft(assignment, shortlist([item()]));

    expect(fake.calls[0]?.wallTimeMs).toBe(1234);
  });
});

describe("writeDraft: hashtags are the writer's, not the model's", () => {
  it("lowercases, strips the hash, dedupes and keeps the two required tags", async () => {
    const fake = fakeGenerate([goodDraft({ hashtags: ["#SpaceNews", "spacenews", "Bay Area", "FALCON9", "starlink"] })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.hashtags).toEqual(["rocketry", "lahs", "spacenews", "bayarea", "falcon9", "starlink"]);
  });

  it("pads a thin answer from the pillar list up to five", async () => {
    const fake = fakeGenerate([goodDraft({ hashtags: ["starlink"] })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(draft.hashtags.slice(0, 3)).toEqual(["rocketry", "lahs", "starlink"]);
  });

  it("pads from the pillar's own list", async () => {
    const fake = fakeGenerate([goodDraft({ hashtags: [] })]);
    const draft = await writerWith(fake, { guides }).writeDraft(
      { ...assignment, pillar: "opportunities" },
      shortlist([item({ deadlineAt: "2026-10-03T23:59:00-07:00" })], "opportunities"),
    );

    expect(draft.hashtags).toContain("internship");
  });

  it("trims to eight without dropping the required tags", async () => {
    const many = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "rocketry"];
    const fake = fakeGenerate([goodDraft({ hashtags: many })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.hashtags).toHaveLength(8);
    expect(draft.hashtags).toContain("rocketry");
    expect(draft.hashtags).toContain("lahs");
  });
});

describe("writeDraft: the source line is in the caption", () => {
  it("appends it verbatim when the model forgot", async () => {
    const fake = fakeGenerate([
      goodDraft({ caption: "A Falcon 9 lifts off Tue Sep 29, 6:10pm PT. Watch the stream from home." }),
    ]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.caption).toContain(sourceLine);
    expect(draft.caption.trimEnd().endsWith(sourceLine)).toBe(true);
  });

  it("leaves a caption that already carries it alone", async () => {
    const caption = `Hook line here.\n\n${sourceLine}\n\nmore words after the source line.`;
    const fake = fakeGenerate([goodDraft({ caption })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.caption).toBe(caption);
  });
});

describe("writeDraft: the confirm flag", () => {
  it("is added when a launch item has no time of its own", async () => {
    const fake = fakeGenerate([goodDraft()]);
    const draft = await writerWith(fake, { guides }).writeDraft(
      assignment,
      shortlist([item({ startsAt: undefined })]),
    );

    expect(draft.flags).toContain(CONFIRM_FLAG);
  });

  it("is added when a time-sensitive pillar has nothing to name, and not for an explainer", async () => {
    const launches = await writerWith(fakeGenerate([goodDraft()]), { guides }).writeDraft(
      { ...assignment, pillar: "launches" },
      shortlist([], "launches"),
    );
    expect(launches.flags).toContain(CONFIRM_FLAG);

    const explainer = await writerWith(fakeGenerate([goodDraft()]), { guides }).writeDraft(
      { ...assignment, pillar: "explainer" },
      shortlist([], "explainer"),
    );
    expect(explainer.flags).not.toContain(CONFIRM_FLAG);
  });

  it("is not added when every time-sensitive item carries its own time", async () => {
    const fake = fakeGenerate([goodDraft()]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item(), item({ id: "ll-2" })]));

    expect(draft.flags).toEqual([]);
  });

  it("is not added for a pillar that does not turn on a date", async () => {
    const fake = fakeGenerate([goodDraft()]);
    const draft = await writerWith(fake, { guides }).writeDraft(
      { ...assignment, pillar: "explainer" },
      shortlist([item({ startsAt: undefined })], "explainer"),
    );

    expect(draft.flags).toEqual([]);
  });

  it("is not duplicated when the model spelled out why", async () => {
    const fake = fakeGenerate([
      goodDraft({ flags: ["confirm before posting: the Vulcan date has slipped twice"] }),
    ]);
    const draft = await writerWith(fake, { guides }).writeDraft(
      assignment,
      shortlist([item({ startsAt: undefined })]),
    );

    expect(draft.flags).toEqual(["confirm before posting: the Vulcan date has slipped twice"]);
  });

  it("is not duplicated when the model already wrote it", async () => {
    const fake = fakeGenerate([goodDraft({ flags: ["Confirm before posting"] })]);
    const draft = await writerWith(fake, { guides }).writeDraft(
      assignment,
      shortlist([item({ startsAt: undefined })]),
    );

    expect(draft.flags).toEqual(["Confirm before posting"]);
  });
});

describe("writeDraft: slides", () => {
  it("keeps at most ten", async () => {
    const slides = Array.from({ length: 14 }, (_, i) => ({ title: `Slide ${i + 1}`, body: "body" }));
    const fake = fakeGenerate([goodDraft({ slides })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.slides).toHaveLength(10);
    expect(draft.slides[0]?.title).toBe("Slide 1");
  });

  it("makes a cover slide rather than losing a draft with none", async () => {
    const fake = fakeGenerate([goodDraft({ slides: [] })]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.slides).toHaveLength(1);
    expect(draft.slides[0]?.title).toBe("Falcon 9 flies Monday night");
  });
});

describe("writeDraft: the one retry", () => {
  it("asks again with the validation issues, then accepts the correction", async () => {
    const fake = fakeGenerate([goodDraft({ headline: "short" }), goodDraft()]);
    const draft = await writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]));

    expect(draft.headline).toBe("Falcon 9 flies Monday night");
    expect(fake.calls).toHaveLength(2);

    const retry = fake.calls[1]?.user ?? "";
    expect(retry).toContain("Your previous answer failed validation:");
    expect(retry).toContain("Return corrected JSON only.");
    expect(retry).toContain("headline");
    expect(retry).toContain("[1] Falcon 9 · Starlink Group 11-24");
  });

  it("gives up after two bad answers and hands both back", async () => {
    const bad = { headline: "short", slides: "not an array", caption: "too short" };
    const fake = fakeGenerate([bad, bad]);

    await expect(writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]))).rejects.toThrow(
      DraftInvalidError,
    );
    expect(fake.calls).toHaveLength(2);
  });

  it("carries the raw text and the issues of both attempts", async () => {
    const fake = fakeGenerate(["not json at all", "still not json"]);
    const error = await writerWith(fake, { guides })
      .writeDraft(assignment, shortlist([item()]))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DraftInvalidError);
    const invalid = error as DraftInvalidError;
    expect(invalid.attempts).toHaveLength(2);
    expect(invalid.attempts[0]?.raw).toBe("not json at all");
    expect(invalid.attempts[1]?.issues.length).toBeGreaterThan(0);
  });

  it("never asks a third time", async () => {
    const bad = { headline: "short" };
    const fake = fakeGenerate([bad, bad, goodDraft()]);

    await expect(writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]))).rejects.toThrow(
      DraftInvalidError,
    );
    expect(fake.calls).toHaveLength(2);
  });

  it("does not retry when the model itself is unreachable", async () => {
    const fake = fakeGenerate([new ModelUnavailableError("nothing listening"), goodDraft()]);

    await expect(writerWith(fake, { guides }).writeDraft(assignment, shortlist([item()]))).rejects.toThrow(
      ModelUnavailableError,
    );
    expect(fake.calls).toHaveLength(1);
  });
});

describe("createWriter", () => {
  it("reads the guides once, at creation", async () => {
    const dir = await guidesDirWith("VOICE ONE", "FENCE ONE");
    const bodies: Record<string, unknown>[] = [];
    const fetchStub = (async (_input: unknown, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(goodDraft()) } }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const writer = createWriter({
      model: { kind: "http", baseUrl: "http://model.test/v1", apiKey: "k", model: "m" },
      guidesDir: dir,
      fetch: fetchStub,
    });

    await writer.writeDraft(assignment, shortlist([item()]));
    await writeFile(join(dir, "voice.md"), "VOICE TWO", "utf8");
    await writer.writeDraft(assignment, shortlist([item()]));

    const systemOf = (body: Record<string, unknown>): string =>
      ((body["messages"] as { content: string }[])[0]?.content ?? "");
    expect(bodies).toHaveLength(2);
    expect(systemOf(bodies[0] as Record<string, unknown>)).toContain("VOICE ONE");
    expect(systemOf(bodies[1] as Record<string, unknown>)).toContain("VOICE ONE");
    expect(systemOf(bodies[1] as Record<string, unknown>)).not.toContain("VOICE TWO");
  });

  it("throws when the guides are missing, rather than writing without them", () => {
    expect(() => createWriter({ model: { kind: "fake", replies: [] }, guidesDir: "/no/such/guides" })).toThrow();
  });

  it("drives the fake harness end to end from the real guides", async () => {
    const writer = createWriter({
      model: { kind: "fake", replies: [goodDraft()] },
      guidesDir: GUIDES_DIR,
      wallTimeMs: 1_000,
    });
    const draft = await writer.writeDraft(assignment, shortlist([item()]));

    expect(draft.sourceLine).toBe(sourceLine);
  });
});

describe('createWriter: model "auto"', () => {
  const env = {
    LOCAL_LLM_BASE_URL: "http://127.0.0.1:18085/v1",
    LOCAL_LLM_API_KEY: "local-no-auth",
    LOCAL_LLM_MODEL: "mtplx-qwen38-27b-optimized-quality",
  };

  it("picks http when the local server answers /models", async () => {
    const seen: string[] = [];
    const fetchStub = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;

    const choice = await resolveModelChoice({ model: "auto", guidesDir: GUIDES_DIR, fetch: fetchStub, env });

    expect(choice).toEqual({
      kind: "http",
      baseUrl: "http://127.0.0.1:18085/v1",
      apiKey: "local-no-auth",
      model: "mtplx-qwen38-27b-optimized-quality",
    });
    expect(seen).toEqual(["http://127.0.0.1:18085/v1/models"]);
  });

  it("falls back to the qwen harness when nothing answers", async () => {
    const fetchStub = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as typeof fetch;

    const choice = await resolveModelChoice({ model: "auto", guidesDir: GUIDES_DIR, fetch: fetchStub, env });

    expect(choice).toEqual({ kind: "qwen" });
  });

  it("falls back to the qwen harness when the server answers badly", async () => {
    const fetchStub = (async () => new Response("nope", { status: 500 })) as typeof fetch;

    const choice = await resolveModelChoice({ model: "auto", guidesDir: GUIDES_DIR, fetch: fetchStub, env });

    expect(choice).toEqual({ kind: "qwen" });
  });

  it("uses the documented defaults when the environment says nothing", async () => {
    const fetchStub = (async () => new Response("{}", { status: 200 })) as typeof fetch;

    const choice = await resolveModelChoice({ model: "auto", guidesDir: GUIDES_DIR, fetch: fetchStub, env: {} });

    expect(choice).toMatchObject({ kind: "http", baseUrl: "http://127.0.0.1:18085/v1", apiKey: "local-no-auth" });
  });
});
