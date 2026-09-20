import { describe, expect, it } from "vitest";
import type { Draft } from "../newsroom/types.js";
import { makeDraft, sampleSlides, sampleText } from "../store/test-fixtures.js";
import {
  captionFor,
  MAX_POLLS,
  next,
  resume,
  type AnyEvent,
  type Command,
  type State,
} from "./machine.js";

const NOW = new Date("2026-09-26T22:05:00.000Z");
const ID = "2026-09-26-explainer-abc123";

const carouselDraft = (overrides: Partial<Draft> = {}): Draft =>
  makeDraft({ id: ID, status: "publishing", slides: sampleSlides(2), ...overrides });

const singleDraft = (overrides: Partial<Draft> = {}): Draft =>
  makeDraft({ id: ID, status: "publishing", slides: sampleSlides(1), ...overrides });

/** Folds a script of events, returning every command the driver would run. */
function drive(start: State, events: AnyEvent[]): { state: State; commands: Command[] } {
  let state = start;
  const commands: Command[] = [];
  for (const event of events) {
    const step = next(state, event);
    state = step.state;
    commands.push(...step.commands);
  }
  return { state, commands };
}

const types = (commands: Command[]): string[] => commands.map((c) => c.type);

describe("captionFor", () => {
  it("is the caption, a blank line, then the hashtags", () => {
    expect(captionFor(sampleText({ caption: "Hello.", hashtags: ["rocketry", "lahs"] }))).toBe(
      "Hello.\n\n#rocketry #lahs",
    );
  });
});

describe("a carousel from the start", () => {
  it("hosts, waits, builds one child per slide, polls, then one parent and one publish", () => {
    const draft = carouselDraft();
    const { state, commands } = drive(resume(draft, NOW), [
      { type: "begin" },
      { type: "hosted", urls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"] },
      { type: "served" },
      { type: "container", id: "child-1" },
      { type: "container", id: "child-2" },
      { type: "statuses", statuses: ["FINISHED", "FINISHED"] },
      { type: "container", id: "carousel-1" },
      { type: "publishedOk", mediaId: "media-1", permalink: "https://instagram.test/p/1" },
    ]);

    expect(types(commands)).toEqual([
      "hostImages",
      "saveImageUrls",
      "waitServed",
      "createChild",
      "saveContainerIds",
      "createChild",
      "saveContainerIds",
      "pollChildren",
      "createCarousel",
      "saveCarouselId",
      "publish",
      "markPublished",
      "removeImages",
      "announce",
    ]);
    expect(commands[0]).toEqual({
      type: "hostImages",
      files: [
        { name: `${ID}-1.jpg`, path: draft.slides[0]?.path },
        { name: `${ID}-2.jpg`, path: draft.slides[1]?.path },
      ],
    });
    expect(commands[3]).toEqual({ type: "createChild", imageUrl: "https://pages.test/a.jpg", index: 0 });
    expect(commands.find((c) => c.type === "createCarousel")).toEqual({
      type: "createCarousel",
      children: ["child-1", "child-2"],
      caption: captionFor(draft.text),
    });
    expect(commands.find((c) => c.type === "removeImages")).toEqual({
      type: "removeImages",
      names: [`${ID}-1.jpg`, `${ID}-2.jpg`],
    });
    expect(state.phase).toBe("published");
  });

  it("records each container id before Instagram is asked for the next one", () => {
    const { commands } = drive(resume(carouselDraft(), NOW), [
      { type: "begin" },
      { type: "hosted", urls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"] },
      { type: "served" },
      { type: "container", id: "child-1" },
    ]);
    const saved = commands.filter((c) => c.type === "saveContainerIds");
    expect(saved).toEqual([{ type: "saveContainerIds", ids: ["child-1"] }]);
    expect(types(commands).indexOf("saveContainerIds")).toBeLessThan(types(commands).lastIndexOf("createChild"));
  });

  it("keeps polling while a child is still in progress, and gives up after five minutes", () => {
    const start = resume(carouselDraft(), NOW);
    const opened = drive(start, [
      { type: "begin" },
      { type: "hosted", urls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"] },
      { type: "served" },
      { type: "container", id: "child-1" },
      { type: "container", id: "child-2" },
    ]);

    const waiting = next(opened.state, { type: "statuses", statuses: ["IN_PROGRESS", "FINISHED"] });
    expect(types(waiting.commands)).toEqual(["sleep", "pollChildren"]);

    let state = waiting.state;
    for (let i = 1; i < MAX_POLLS - 1; i += 1) {
      state = next(state, { type: "statuses", statuses: ["IN_PROGRESS", "FINISHED"] }).state;
    }
    const last = next(state, { type: "statuses", statuses: ["IN_PROGRESS", "FINISHED"] });
    expect(last.state.phase).toBe("failed");
    expect(types(last.commands)).toEqual(["markFailed"]);
  });

  it("fails the draft when Instagram rejects a slide", () => {
    const opened = drive(resume(carouselDraft(), NOW), [
      { type: "begin" },
      { type: "hosted", urls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"] },
      { type: "served" },
      { type: "container", id: "child-1" },
      { type: "container", id: "child-2" },
      { type: "statuses", statuses: ["FINISHED", "ERROR"] },
    ]);
    expect(opened.state.phase).toBe("failed");
    expect(opened.commands.at(-1)).toMatchObject({ type: "markFailed" });
  });
});

describe("a single image", () => {
  it("goes straight to one container with the caption and publishes it", () => {
    const draft = singleDraft();
    const { state, commands } = drive(resume(draft, NOW), [
      { type: "begin" },
      { type: "hosted", urls: ["https://pages.test/only.jpg"] },
      { type: "served" },
      { type: "container", id: "single-1" },
      { type: "publishedOk", mediaId: "media-2" },
    ]);

    expect(types(commands)).toEqual([
      "hostImages",
      "saveImageUrls",
      "waitServed",
      "createSingle",
      "saveContainerIds",
      "publish",
      "markPublished",
      "removeImages",
      "announce",
    ]);
    expect(commands[3]).toEqual({
      type: "createSingle",
      imageUrl: "https://pages.test/only.jpg",
      caption: captionFor(draft.text),
    });
    expect(commands).not.toContainEqual(expect.objectContaining({ type: "createCarousel" }));
    expect(state).toMatchObject({ phase: "published", mediaId: "media-2" });
  });
});

describe("resuming after a crash", () => {
  it("continues from the children it already has: one parent, one publish, no new child", () => {
    const draft = carouselDraft({
      publish: {
        imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
        containerIds: ["child-1", "child-2"],
      },
    });

    const { state, commands } = drive(resume(draft, NOW), [
      { type: "begin" },
      { type: "statuses", statuses: ["FINISHED", "FINISHED"] },
      { type: "container", id: "carousel-1" },
      { type: "publishedOk", mediaId: "media-3", permalink: "https://instagram.test/p/3" },
    ]);

    expect(types(commands)).toEqual([
      "pollChildren",
      "createCarousel",
      "saveCarouselId",
      "publish",
      "markPublished",
      "removeImages",
      "announce",
    ]);
    expect(commands.filter((c) => c.type === "createCarousel")).toHaveLength(1);
    expect(commands.filter((c) => c.type === "publish")).toHaveLength(1);
    expect(commands.filter((c) => c.type === "hostImages")).toHaveLength(0);
    expect(state.phase).toBe("published");
  });

  it("creates only the children that are missing", () => {
    const draft = carouselDraft({
      slides: sampleSlides(3),
      publish: {
        imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg", "https://pages.test/c.jpg"],
        containerIds: ["child-1"],
      },
    });
    const { commands } = drive(resume(draft, NOW), [{ type: "begin" }]);
    expect(commands).toEqual([
      { type: "createChild", imageUrl: "https://pages.test/b.jpg", index: 1 },
    ]);
  });

  it("never creates a second parent when one is recorded", () => {
    const draft = carouselDraft({
      publish: {
        imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
        containerIds: ["child-1", "child-2"],
        carouselId: "carousel-1",
      },
    });

    const { state, commands } = drive(resume(draft, NOW), [
      { type: "begin" },
      { type: "status", status: "FINISHED" },
      { type: "publishedOk", mediaId: "media-4" },
    ]);

    expect(types(commands)).toEqual([
      "pollContainer",
      "publish",
      "markPublished",
      "removeImages",
      "announce",
    ]);
    expect(commands.filter((c) => c.type === "createCarousel")).toHaveLength(0);
    expect(commands.find((c) => c.type === "publish")).toEqual({
      type: "publish",
      containerId: "carousel-1",
    });
    expect(state.phase).toBe("published");
  });

  it("marks a draft published without publishing again when the media id is already recorded", () => {
    const draft = carouselDraft({
      publish: {
        imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
        containerIds: ["child-1", "child-2"],
        carouselId: "carousel-1",
        mediaId: "media-5",
        permalink: "https://instagram.test/p/5",
      },
    });

    const { state, commands } = drive(resume(draft, NOW), [{ type: "begin" }]);

    expect(types(commands)).toEqual(["markPublished", "removeImages", "announce"]);
    expect(commands[0]).toEqual({
      type: "markPublished",
      mediaId: "media-5",
      permalink: "https://instagram.test/p/5",
    });
    expect(state.phase).toBe("published");
  });

  it("takes a parent that already published as published, even with no media id", () => {
    const draft = carouselDraft({
      publish: {
        imageUrls: ["https://pages.test/a.jpg"],
        containerIds: ["child-1", "child-2"],
        carouselId: "carousel-1",
      },
    });
    const { state, commands } = drive(resume(draft, NOW), [
      { type: "begin" },
      { type: "status", status: "PUBLISHED" },
    ]);
    expect(types(commands)).toEqual(["pollContainer", "markPublished", "removeImages", "announce"]);
    expect(state).toMatchObject({ phase: "published" });
    expect(commands.filter((c) => c.type === "publish")).toHaveLength(0);
  });

  it("starts over when the parent container died", () => {
    const draft = carouselDraft({
      publish: { imageUrls: [], containerIds: ["child-1"], carouselId: "carousel-1" },
    });
    for (const status of ["ERROR", "EXPIRED"] as const) {
      const { state, commands } = drive(resume(draft, NOW), [
        { type: "begin" },
        { type: "status", status },
      ]);
      expect(state.phase).toBe("reset");
      expect(commands.at(-1)).toMatchObject({ type: "reset" });
    }
  });

  it("starts over when the crash left nothing behind", () => {
    const draft = carouselDraft({ publish: { imageUrls: [], containerIds: [] } });
    const { state, commands } = drive(resume(draft, NOW), [{ type: "begin" }]);
    expect(state.phase).toBe("reset");
    expect(types(commands)).toEqual(["reset"]);
  });

  it("checks the recorded container of a single-slide draft, then publishes it once it is FINISHED", () => {
    const draft = singleDraft({
      publish: { imageUrls: ["https://pages.test/only.jpg"], containerIds: ["single-1"] },
    });
    const checking = next(resume(draft, NOW), { type: "begin" });
    expect(checking.commands).toEqual([{ type: "pollContainer", id: "single-1" }]);
    const { commands } = next(checking.state, { type: "status", status: "FINISHED" });
    expect(commands).toEqual([{ type: "publish", containerId: "single-1" }]);
  });
});
