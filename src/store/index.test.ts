import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  contentHashOf,
  createDraftStore,
  DraftNotFoundError,
  IllegalTransitionError,
  newDraft,
  publishByFor,
} from "./index.js";
import {
  makeDraft,
  sampleAssignment,
  sampleItem,
  samplePhoto,
  sampleText,
  writeSlideFiles,
} from "./test-fixtures.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drafts-"));
});

describe("save, get and list", () => {
  it("round-trips a draft through one JSON file per draft", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft();
    await store.save(draft);
    expect(await readdir(dir)).toEqual([`${draft.id}.json`]);
    expect(await store.get(draft.id)).toEqual(draft);
  });

  it("returns undefined for a draft that was never written", async () => {
    const store = createDraftStore(dir);
    expect(await store.get("2026-01-01-club-000000")).toBeUndefined();
  });

  it("lists nothing when the directory does not exist yet", async () => {
    const store = createDraftStore(join(dir, "not-yet"));
    expect(await store.list()).toEqual([]);
  });

  it("lists by status, oldest first", async () => {
    const store = createDraftStore(dir);
    await store.save(makeDraft({ id: "b", createdAt: "2026-09-25T04:00:00.000Z", status: "approved" }));
    await store.save(makeDraft({ id: "a", createdAt: "2026-09-25T03:00:00.000Z", status: "pending" }));
    await store.save(makeDraft({ id: "c", createdAt: "2026-09-25T05:00:00.000Z", status: "published" }));

    expect((await store.list()).map((d) => d.id)).toEqual(["a", "b", "c"]);
    expect((await store.list({ status: "approved" })).map((d) => d.id)).toEqual(["b"]);
    expect((await store.list({ status: ["pending", "published"] })).map((d) => d.id)).toEqual(["a", "c"]);
  });

  it("rejects a file that is not a valid draft", async () => {
    const store = createDraftStore(dir);
    await writeFile(join(dir, "broken.json"), JSON.stringify({ id: "broken" }), "utf8");
    await expect(store.get("broken")).rejects.toThrow();
  });

  it("leaves no partial file behind: the draft appears whole or not at all", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft();
    await store.save(draft);
    await store.save({ ...draft, status: "approved" });
    const names = await readdir(dir);
    expect(names).toEqual([`${draft.id}.json`]);
    const parsed: unknown = JSON.parse(await readFile(join(dir, names[0] as string), "utf8"));
    expect((parsed as { status: string }).status).toBe("approved");
  });
});

describe("transition", () => {
  it("moves a draft along a legal edge and applies the patch", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft();
    await store.save(draft);

    const approved = await store.transition(draft.id, "pending", "approved", {
      verdict: { decision: "approved", by: "president", at: "2026-09-25T18:00:00.000Z", contentHash: draft.contentHash },
    });

    expect(approved.status).toBe("approved");
    expect(approved.verdict?.by).toBe("president");
    expect((await store.get(draft.id))?.status).toBe("approved");
  });

  it("refuses a transition that is not in TRANSITIONS", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft();
    await store.save(draft);
    await expect(store.transition(draft.id, "pending", "published")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
    expect((await store.get(draft.id))?.status).toBe("pending");
  });

  it("refuses when the draft is not in the status the caller expected", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft({ status: "approved" });
    await store.save(draft);
    const error = await store.transition(draft.id, "pending", "approved").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IllegalTransitionError);
    expect((error as Error).message).toContain("expected status pending but found approved");
  });

  it("refuses to move a published draft anywhere", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft({ status: "published" });
    await store.save(draft);
    await expect(store.transition(draft.id, "published", "pending")).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });

  it("complains about an unknown draft", async () => {
    const store = createDraftStore(dir);
    await expect(store.transition("nope", "pending", "approved")).rejects.toBeInstanceOf(
      DraftNotFoundError,
    );
  });

  it("lets a failed draft be picked up again", async () => {
    const store = createDraftStore(dir);
    const draft = makeDraft({ status: "failed", error: "renderSlides: chromium missing" });
    await store.save(draft);
    const retried = await store.transition(draft.id, "failed", "pending");
    expect(retried.status).toBe("pending");
  });
});

describe("contentHashOf", () => {
  it("covers the words and the pixels", async () => {
    const slides = await writeSlideFiles(join(dir, "slides"), 2);
    const paths = slides.map((s) => s.path);
    const base = await contentHashOf(sampleText(), paths);

    expect(await contentHashOf(sampleText(), paths)).toBe(base);
    expect(await contentHashOf(sampleText({ caption: `${sampleText().caption} Edited.` }), paths)).not.toBe(base);

    await writeFile(paths[0] as string, Buffer.from([0xff, 0xd8, 0x00, 0x01]));
    expect(await contentHashOf(sampleText(), paths)).not.toBe(base);
  });

  it("does not depend on key order in the text", async () => {
    const slides = await writeSlideFiles(join(dir, "slides"), 1);
    const paths = slides.map((s) => s.path);
    const text = sampleText();
    const reordered = {
      flags: text.flags,
      hashtags: text.hashtags,
      sourceLine: text.sourceLine,
      caption: text.caption,
      slides: text.slides,
      headline: text.headline,
    };
    expect(await contentHashOf(reordered, paths)).toBe(await contentHashOf(text, paths));
  });
});

describe("newDraft", () => {
  const now = new Date("2026-09-25T03:30:00.000Z");

  it("names a draft by its day, its pillar and its content", async () => {
    const slides = await writeSlideFiles(join(dir, "slides"), 2);
    const draft = await newDraft({ assignment: sampleAssignment(), text: sampleText(), slides, now });

    expect(draft.id).toMatch(/^2026-09-26-explainer-[0-9a-f]{6}$/);
    expect(draft.id.endsWith(draft.contentHash.slice(0, 6))).toBe(true);
    expect(draft.status).toBe("pending");
    expect(draft.createdAt).toBe(now.toISOString());
    expect(draft.photo).toBeUndefined();
  });

  it("keeps the licensed photo when there is one", async () => {
    const slides = await writeSlideFiles(join(dir, "slides"), 1);
    const draft = await newDraft({
      assignment: sampleAssignment(),
      text: sampleText(),
      slides,
      photo: samplePhoto(),
      now,
    });
    expect(draft.photo?.credit).toBe("NASA");
  });

  it("expires a day and a half out when nothing else sets the deadline", async () => {
    const slides = await writeSlideFiles(join(dir, "slides"), 1);
    const draft = await newDraft({ assignment: sampleAssignment(), text: sampleText(), slides, now });
    expect(draft.publishBy).toBe("2026-09-26T15:30:00.000Z");
  });
});

describe("publishByFor", () => {
  const now = new Date("2026-09-25T03:30:00.000Z");

  it("posts a launch before it happens", () => {
    const by = publishByFor(now, [sampleItem({ startsAt: "2026-09-25T22:00:00.000Z" })]);
    expect(by).toBe("2026-09-25T22:00:00.000Z");
  });

  it("gives a deadline a day of room", () => {
    const by = publishByFor(now, [sampleItem({ deadlineAt: "2026-09-26T07:00:00.000Z" })]);
    expect(by).toBe("2026-09-25T07:00:00.000Z");
  });

  it("takes the earliest of every reason to hurry", () => {
    const by = publishByFor(now, [
      sampleItem({ id: "a", startsAt: "2026-09-26T12:00:00.000Z" }),
      sampleItem({ id: "b", deadlineAt: "2026-09-26T09:00:00.000Z" }),
    ]);
    expect(by).toBe("2026-09-25T09:00:00.000Z");
  });

  it("never expires a draft before an approver could have answered", () => {
    const by = publishByFor(now, [sampleItem({ startsAt: "2026-09-25T03:40:00.000Z" })]);
    expect(by).toBe("2026-09-25T05:30:00.000Z");
  });

  it("ignores times it cannot read", () => {
    const by = publishByFor(now, [sampleItem({ startsAt: "soon" })]);
    expect(by).toBe("2026-09-26T15:30:00.000Z");
  });
});
