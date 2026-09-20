import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DiscordPort } from "../newsroom/ports.js";
import type { Draft, Shortlist, Slide } from "../newsroom/types.js";
import { createDraftStore } from "../store/index.js";
import {
  makeDraft,
  sampleAssignment,
  sampleItem,
  samplePhoto,
  sampleText,
  writeSlideFiles,
} from "../store/test-fixtures.js";
import {
  ensureModelServer,
  nextAssignmentDate,
  runDaily,
  type DailyDeps,
  type RunStep,
} from "./index.js";

const DATE = "2026-09-26";
const NOW = new Date("2026-09-25T03:30:00.000Z");

type Harness = {
  deps: DailyDeps;
  calls: string[];
  notices: string[];
  posted: { draft: Draft; slides: Slide[] }[];
  slides: Slide[];
  fail: (step: RunStep, message: string) => void;
};

function fakeDiscord(notices: string[], posted: Harness["posted"]): DiscordPort {
  return {
    async postDraft(draft, slides) {
      posted.push({ draft, slides });
      return { messageId: "msg-1" };
    },
    async readVerdict() {
      return undefined;
    },
    async notify(text) {
      notices.push(text);
    },
  };
}

async function harness(dir: string): Promise<Harness> {
  const calls: string[] = [];
  const notices: string[] = [];
  const posted: Harness["posted"] = [];
  const slides = await writeSlideFiles(join(dir, "out", DATE), 2);
  const failures = new Map<RunStep, string>();
  const guard = (step: RunStep): void => {
    calls.push(step);
    const message = failures.get(step);
    if (message) throw new Error(message);
  };

  const deps: DailyDeps = {
    now: () => NOW,
    async readAssignment(date, planDir) {
      guard("readAssignment");
      calls.push(`plan:${planDir}`);
      return sampleAssignment({ date });
    },
    async fetchItems(pillar, opts) {
      guard("fetchItems");
      calls.push(`pillar:${pillar}`, `cache:${opts.cacheDir}`);
      return [sampleItem({ startsAt: "2026-09-26T14:00:00.000Z" })];
    },
    shortlist(items, assignment): Shortlist {
      guard("shortlist");
      return { assignment, items, notes: ["one launch in range"] };
    },
    async findLicensedPhoto(_shortlist, opts) {
      guard("findLicensedPhoto");
      calls.push(`photos:${opts.photoDir}`);
      return samplePhoto();
    },
    writer: {
      async writeDraft() {
        guard("writeDraft");
        return sampleText();
      },
    },
    async renderSlides(_text, _pillar, _photo, outDir) {
      guard("renderSlides");
      calls.push(`out:${outDir}`);
      return slides;
    },
    store: createDraftStore(join(dir, "state")),
    discord: fakeDiscord(notices, posted),
    home: { lat: 37.3688, lon: -122.1131 },
    dirs: {
      cache: join(dir, "cache"),
      photos: join(dir, "photos"),
      out: join(dir, "out"),
      plan: join(dir, "plan"),
    },
  };

  return {
    deps,
    calls,
    notices,
    posted,
    slides,
    fail: (step, message) => failures.set(step, message),
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "runner-"));
});

describe("runDaily", () => {
  it("reports a model server that will not start like any other step", async () => {
    const h = await harness(dir);
    h.deps.ensureModelServer = async () => {
      throw new Error("mtplx did not answer");
    };
    const result = await runDaily({ date: DATE, deps: h.deps });
    expect(result).toMatchObject({ ok: false, step: "ensureModelServer" });
    expect(h.notices.join("\n")).toMatch(/ensureModelServer/);
    expect(h.notices.join("\n")).toMatch(/mtplx did not answer/);
    expect(h.posted).toHaveLength(0);
  });

  it("runs the steps in order and leaves a pending draft on the board", async () => {
    const h = await harness(dir);
    const result = await runDaily({ date: DATE, deps: h.deps });

    expect(result).toMatchObject({ ok: true });
    expect(h.calls.filter((c) => !c.includes(":"))).toEqual([
      "readAssignment",
      "fetchItems",
      "shortlist",
      "findLicensedPhoto",
      "writeDraft",
      "renderSlides",
    ]);
    expect(h.calls).toContain(`plan:${join(dir, "plan")}`);
    expect(h.calls).toContain(`cache:${join(dir, "cache")}`);
    expect(h.calls).toContain(`photos:${join(dir, "photos")}`);
    expect(h.calls).toContain(`out:${join(dir, "out", DATE)}`);

    if (!result.ok) throw new Error("expected a draft");
    const draft = await h.deps.store.get(result.draftId);
    expect(draft?.status).toBe("pending");
    expect(draft?.assignment.date).toBe(DATE);
    expect(draft?.discordMessageId).toBe("msg-1");
    expect(draft?.photo?.credit).toBe("NASA");
    // The launch starts before creation + 36h, so it sets the expiry.
    expect(draft?.publishBy).toBe("2026-09-26T14:00:00.000Z");
    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]?.slides).toEqual(h.slides);
    expect(h.notices).toEqual([]);
  });

  it("posts the card only after the draft is on disk", async () => {
    const h = await harness(dir);
    let statusWhenPosted: string | undefined;
    const inner = h.deps.discord.postDraft.bind(h.deps.discord);
    h.deps.discord.postDraft = async (draft, slides) => {
      statusWhenPosted = (await h.deps.store.get(draft.id))?.status;
      return inner(draft, slides);
    };
    await runDaily({ date: DATE, deps: h.deps });
    expect(statusWhenPosted).toBe("pending");
  });

  it("skips a day that already has a draft, whatever became of it", async () => {
    for (const status of ["pending", "approved", "published", "expired", "rejected"] as const) {
      const h = await harness(dir);
      const existing = makeDraft({ id: `${DATE}-explainer-aaa${status.length}`, status });
      await h.deps.store.save(existing);

      const result = await runDaily({ date: DATE, deps: h.deps });

      expect(result).toEqual({ ok: true, draftId: existing.id, skipped: "exists" });
      expect(h.calls).toEqual([]);
      dir = await mkdtemp(join(tmpdir(), "runner-"));
    }
  });

  it("tries again on a day whose last attempt failed", async () => {
    const h = await harness(dir);
    await h.deps.store.save(makeDraft({ status: "failed", error: "renderSlides: no chromium" }));
    const result = await runDaily({ date: DATE, deps: h.deps });
    expect(result).toMatchObject({ ok: true });
    expect(h.calls).toContain("writeDraft");
  });

  it("reports the step that broke and never throws", async () => {
    const h = await harness(dir);
    h.fail("fetchItems", "Launch Library returned 503");

    const result = await runDaily({ date: DATE, deps: h.deps });

    expect(result).toEqual({ ok: false, step: "fetchItems", error: "Launch Library returned 503" });
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]).toContain("fetchItems");
    expect(h.notices[0]).toContain("Launch Library returned 503");
    expect(h.notices[0]).toContain(DATE);
    expect(await h.deps.store.list()).toEqual([]);
  });

  it("marks the draft failed when the card cannot be posted", async () => {
    const h = await harness(dir);
    h.deps.discord.postDraft = async () => {
      throw new Error("Discord 403");
    };

    const result = await runDaily({ date: DATE, deps: h.deps });

    expect(result).toMatchObject({ ok: false, step: "postDraft", error: "Discord 403" });
    const drafts = await h.deps.store.list();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("failed");
    expect(drafts[0]?.error).toBe("Discord 403");
    expect(h.notices[0]).toContain("is marked failed");
  });

  it("survives a Discord that cannot even take the failure report", async () => {
    const h = await harness(dir);
    h.fail("writeDraft", "model timed out");
    h.deps.discord.notify = async () => {
      throw new Error("Discord down");
    };
    await expect(runDaily({ date: DATE, deps: h.deps })).resolves.toMatchObject({
      ok: false,
      step: "writeDraft",
    });
  });

  it("expires a dry run the moment the card is posted", async () => {
    const h = await harness(dir);
    const result = await runDaily({ date: DATE, deps: h.deps, dryRun: true });

    expect(result).toMatchObject({ ok: true, dryRun: true });
    if (!result.ok) throw new Error("expected a draft");
    expect((await h.deps.store.get(result.draftId))?.status).toBe("expired");
    expect(h.posted).toHaveLength(1);
  });
});

describe("nextAssignmentDate", () => {
  it("drafts for tomorrow in the evening", () => {
    expect(nextAssignmentDate(new Date("2026-09-26T03:30:00.000Z"))).toBe("2026-09-26");
  });

  it("drafts for today when the missed job runs on wake the next morning", () => {
    expect(nextAssignmentDate(new Date("2026-09-26T16:00:00.000Z"))).toBe("2026-09-26");
  });

  it("crosses a month boundary", () => {
    expect(nextAssignmentDate(new Date("2026-10-01T03:30:00.000Z"))).toBe("2026-10-01");
    expect(nextAssignmentDate(new Date("2026-10-01T04:00:00.000Z"))).toBe("2026-10-01");
  });
});

describe("ensureModelServer", () => {
  const base = "http://127.0.0.1:18085/v1";

  it("does nothing when the server already answers", async () => {
    const started: string[][] = [];
    const urls: string[] = [];
    await ensureModelServer({
      baseUrl: base,
      exec: (argv) => started.push([...argv]),
      fetch: async (input) => {
        urls.push(String(input));
        return new Response("{}", { status: 200 });
      },
      sleep: async () => undefined,
    });
    expect(urls).toEqual([`${base}/models`]);
    expect(started).toEqual([]);
  });

  it("starts the server detached and waits for it", async () => {
    const started: string[][] = [];
    const waits: number[] = [];
    let attempts = 0;
    await ensureModelServer({
      baseUrl: `${base}/`,
      exec: (argv) => started.push([...argv]),
      fetch: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("ECONNREFUSED");
        return new Response("{}", { status: 200 });
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(started).toEqual([["mtplx", "quickstart", "--port", "18085"]]);
    expect(waits).toEqual([5000, 5000]);
    expect(attempts).toBe(3);
  });

  it("gives up after the timeout", async () => {
    let clock = Date.parse("2026-09-25T03:30:00.000Z");
    await expect(
      ensureModelServer({
        baseUrl: base,
        exec: () => undefined,
        startCommand: ["mtplx", "quickstart"],
        timeoutMs: 20_000,
        fetch: async () => new Response("no", { status: 503 }),
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => new Date(clock),
      }),
    ).rejects.toThrow(/did not answer .*\/models within 20s/);
  });
});
