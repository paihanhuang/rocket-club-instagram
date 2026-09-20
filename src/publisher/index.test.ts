import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { DiscordPort, ImageHostPort, InstagramPort } from "../newsroom/ports.js";
import type { Draft, Verdict } from "../newsroom/types.js";
import { createDraftStore } from "../store/index.js";
import { makeDraft, sampleSlides, sampleText } from "../store/test-fixtures.js";
import { captionFor, type ContainerStatus } from "./machine.js";
import {
  DEFAULT_SHARE_CHECKLIST,
  HASH_MISMATCH_NOTE,
  runPublisher,
  writeTokenFile,
  type PublisherDeps,
  type TokenRecord,
} from "./index.js";

/** 15:05 in Los Altos: the publish window is open. */
const NOW = new Date("2026-09-26T22:05:00.000Z");
/** 11:00 in Los Altos: too early to publish. */
const MORNING = new Date("2026-09-26T18:00:00.000Z");
const HASH = "hash-of-the-card";

type FakeInstagram = InstagramPort & { calls: string[]; containers: string[] };

function fakeInstagram(
  options: {
    quota?: { used: number; total: number };
    statuses?: ContainerStatus[];
    permalink?: string;
    throwOn?: Partial<Record<string, string>>;
    refresh?: () => Promise<{ token: string; expiresAt: string }>;
  } = {},
): FakeInstagram {
  const calls: string[] = [];
  const containers: string[] = [];
  const statuses = options.statuses ?? [];
  let statusIndex = 0;
  let created = 0;
  const check = (method: string): void => {
    const message = options.throwOn?.[method];
    if (message) throw new Error(message);
  };
  return {
    calls,
    containers,
    async createImageContainer(req) {
      calls.push(`createImageContainer:${req.imageUrl}:${req.isCarouselItem ? "child" : "single"}`);
      check("createImageContainer");
      created += 1;
      const id = `container-${created}`;
      containers.push(id);
      return { id };
    },
    async createCarouselContainer(req) {
      calls.push(`createCarouselContainer:${req.children.join(",")}`);
      check("createCarouselContainer");
      containers.push("carousel-1");
      return { id: "carousel-1" };
    },
    async containerStatus(id) {
      calls.push(`containerStatus:${id}`);
      check("containerStatus");
      const status = statuses[statusIndex];
      statusIndex += 1;
      return status ?? "FINISHED";
    },
    async publish(containerId) {
      calls.push(`publish:${containerId}`);
      check("publish");
      return {
        mediaId: "media-1",
        ...(options.permalink === undefined ? {} : { permalink: options.permalink }),
      };
    },
    async quota() {
      calls.push("quota");
      check("quota");
      return options.quota ?? { used: 3, total: 50 };
    },
    async refreshToken() {
      calls.push("refreshToken");
      if (options.refresh) return options.refresh();
      return { token: "fresh-token", expiresAt: "2026-11-25T22:05:00.000Z" };
    },
    async me() {
      return { id: "ig-1", username: "lahsrocketry" };
    },
  };
}

type FakeHost = ImageHostPort & { published: string[][]; removed: string[][]; served: string[][] };

function fakeImageHost(options: { throwOn?: Partial<Record<string, string>> } = {}): FakeHost {
  const published: string[][] = [];
  const removed: string[][] = [];
  const served: string[][] = [];
  return {
    published,
    removed,
    served,
    async publish(files) {
      if (options.throwOn?.publish) throw new Error(options.throwOn.publish);
      published.push(files.map((f) => f.name));
      return files.map((f) => `https://pages.test/${f.name}`);
    },
    async waitUntilServed(urls) {
      if (options.throwOn?.waitUntilServed) throw new Error(options.throwOn.waitUntilServed);
      served.push(urls);
    },
    async remove(names) {
      if (options.throwOn?.remove) throw new Error(options.throwOn.remove);
      removed.push(names);
    },
  };
}

type FakeDiscord = DiscordPort & { notices: string[] };

function fakeDiscord(verdicts: Record<string, Verdict | undefined> = {}): FakeDiscord {
  const notices: string[] = [];
  return {
    notices,
    async postDraft() {
      return { messageId: "msg-1" };
    },
    async readVerdict(draft) {
      return verdicts[draft.id];
    },
    async notify(text) {
      notices.push(text);
    },
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "publisher-"));
});

type Setup = {
  deps: PublisherDeps;
  instagram: FakeInstagram;
  imagehost: FakeHost;
  discord: FakeDiscord;
};

function setup(overrides: Partial<PublisherDeps> & Partial<Setup> = {}): Setup {
  const instagram = overrides.instagram ?? fakeInstagram();
  const imagehost = overrides.imagehost ?? fakeImageHost();
  const discord = overrides.discord ?? fakeDiscord();
  const deps: PublisherDeps = {
    now: () => NOW,
    store: createDraftStore(join(dir, "state")),
    discord,
    imagehost,
    instagram,
    sleep: async () => undefined,
    tokenFile: join(dir, "instagram-token.json"),
    ...overrides,
  };
  return { deps, instagram, imagehost, discord };
}

const approvedDraft = (overrides: Partial<Draft> = {}): Draft =>
  makeDraft({
    id: "2026-09-26-explainer-abc123",
    status: "approved",
    contentHash: HASH,
    publishBy: "2026-09-27T12:00:00.000Z",
    ...overrides,
  });

describe("publishing an approved draft", () => {
  it("hosts the slides, builds the carousel, publishes it, then cleans up", async () => {
    const { deps, instagram, imagehost, discord } = setup({
      instagram: fakeInstagram({ permalink: "https://instagram.test/p/1" }),
    });
    const draft = approvedDraft();
    await deps.store.save(draft);

    const report = await runPublisher(deps);

    expect(instagram.calls).toEqual([
      "quota",
      `createImageContainer:https://pages.test/${draft.id}-1.jpg:child`,
      `createImageContainer:https://pages.test/${draft.id}-2.jpg:child`,
      "containerStatus:container-1",
      "containerStatus:container-2",
      "createCarouselContainer:container-1,container-2",
      "publish:carousel-1",
    ]);
    expect(imagehost.published).toEqual([[`${draft.id}-1.jpg`, `${draft.id}-2.jpg`]]);
    expect(imagehost.served).toEqual([
      [`https://pages.test/${draft.id}-1.jpg`, `https://pages.test/${draft.id}-2.jpg`],
    ]);
    expect(imagehost.removed).toEqual([[`${draft.id}-1.jpg`, `${draft.id}-2.jpg`]]);

    const saved = await deps.store.get(draft.id);
    expect(saved?.status).toBe("published");
    expect(saved?.publish).toEqual({
      imageUrls: [`https://pages.test/${draft.id}-1.jpg`, `https://pages.test/${draft.id}-2.jpg`],
      containerIds: ["container-1", "container-2"],
      carouselId: "carousel-1",
      mediaId: "media-1",
      permalink: "https://instagram.test/p/1",
    });

    expect(report.windowOpen).toBe(true);
    expect(report.considered).toBe(1);
    expect(report.posts).toEqual([
      {
        draftId: draft.id,
        mediaId: "media-1",
        permalink: "https://instagram.test/p/1",
        publishedAt: NOW.toISOString(),
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(discord.notices).toEqual([
      `✅ Published: https://instagram.test/p/1\n${DEFAULT_SHARE_CHECKLIST}`,
    ]);
  });

  it("sends the caption with the hashtags after a blank line", async () => {
    const { deps, instagram } = setup();
    const draft = approvedDraft({ slides: sampleSlides(1) });
    await deps.store.save(draft);

    let sentCaption: string | undefined;
    const inner = instagram.createImageContainer.bind(instagram);
    instagram.createImageContainer = async (req) => {
      sentCaption = req.caption;
      return inner(req);
    };

    await runPublisher(deps);

    expect(sentCaption).toBe(captionFor(draft.text));
    expect(sentCaption).toBe(
      `${draft.text.caption}\n\n#rocketry #lahs #losaltos #stem #spaceflight`,
    );
    expect(instagram.calls).toContain("publish:container-1");
    expect(instagram.calls.some((c) => c.startsWith("createCarouselContainer"))).toBe(false);
  });

  it("uses the club's share checklist when one is configured", async () => {
    const { deps, discord } = setup({ shareChecklist: "Tell the group chat." });
    await deps.store.save(approvedDraft({ slides: sampleSlides(1) }));
    await runPublisher(deps);
    expect(discord.notices[0]).toContain("Tell the group chat.");
  });

  it("publishes the oldest approved draft first", async () => {
    const { deps } = setup();
    await deps.store.save(
      approvedDraft({ id: "newer", createdAt: "2026-09-26T04:00:00.000Z", slides: sampleSlides(1) }),
    );
    await deps.store.save(
      approvedDraft({ id: "older", createdAt: "2026-09-25T04:00:00.000Z", slides: sampleSlides(1) }),
    );
    const report = await runPublisher(deps);
    expect(report.posts.map((p) => p.draftId)).toEqual(["older", "newer"]);
  });

  it("marks one bad draft failed and carries on with the next", async () => {
    const { deps, discord } = setup({
      imagehost: fakeImageHost({ throwOn: { publish: "GitHub Pages is down" } }),
    });
    await deps.store.save(approvedDraft({ id: "first", slides: sampleSlides(1) }));
    await deps.store.save(
      approvedDraft({ id: "second", createdAt: "2026-09-25T05:00:00.000Z", slides: sampleSlides(1) }),
    );

    const report = await runPublisher(deps);

    expect(report.failed).toHaveLength(2);
    expect(report.failed[0]).toEqual({
      draftId: "first",
      step: "hostImages",
      message: "GitHub Pages is down",
    });
    expect((await deps.store.get("first"))?.status).toBe("failed");
    expect((await deps.store.get("second"))?.status).toBe("failed");
    expect((await deps.store.get("first"))?.error).toBe("GitHub Pages is down");
    expect(discord.notices.filter((n) => n.includes("failed to publish"))).toHaveLength(2);
  });
});

describe("the publish window", () => {
  it("does no publishing before it opens, but still expires and collects verdicts", async () => {
    const { deps, instagram, discord } = setup({
      now: () => MORNING,
      discord: fakeDiscord({
        pending: { decision: "approved", by: "president", at: "x", contentHash: HASH },
      }),
    });
    await deps.store.save(approvedDraft());
    await deps.store.save(approvedDraft({ id: "pending", status: "pending" }));

    const report = await runPublisher(deps);

    expect(report.windowOpen).toBe(false);
    expect(report.posts).toEqual([]);
    expect(instagram.calls).toEqual([]);
    expect((await deps.store.get("pending"))?.status).toBe("approved");
    expect(discord.notices).toEqual([]);
  });
});

describe("verdicts", () => {
  it("approves a verdict bound to the current content hash", async () => {
    const verdict: Verdict = {
      decision: "approved",
      by: "president",
      at: "2026-09-26T21:00:00.000Z",
      contentHash: HASH,
    };
    const { deps } = setup({ discord: fakeDiscord({ "2026-09-26-explainer-abc123": verdict }) });
    await deps.store.save(approvedDraft({ status: "pending", slides: sampleSlides(1) }));

    const report = await runPublisher(deps);

    const saved = await deps.store.get("2026-09-26-explainer-abc123");
    expect(saved?.status).toBe("published");
    expect(saved?.verdict).toEqual(verdict);
    expect(report.posts).toHaveLength(1);
  });

  it("records a rejection and never looks at it again", async () => {
    const { deps } = setup({
      discord: fakeDiscord({
        "2026-09-26-explainer-abc123": {
          decision: "rejected",
          by: "advisor",
          at: "2026-09-26T21:00:00.000Z",
          contentHash: HASH,
        },
      }),
    });
    await deps.store.save(approvedDraft({ status: "pending" }));

    const report = await runPublisher(deps);

    expect((await deps.store.get("2026-09-26-explainer-abc123"))?.status).toBe("rejected");
    expect(report.skipped).toContainEqual({
      draftId: "2026-09-26-explainer-abc123",
      reason: "rejected",
    });
    expect(report.posts).toEqual([]);
  });

  it("keeps a draft pending when the approval does not match what is on the card, and says so once", async () => {
    const { deps, discord } = setup({
      discord: fakeDiscord({
        "2026-09-26-explainer-abc123": {
          decision: "approved",
          by: "president",
          at: "2026-09-26T21:00:00.000Z",
          contentHash: "an-older-hash",
        },
      }),
    });
    await deps.store.save(approvedDraft({ status: "pending" }));

    const first = await runPublisher(deps);
    expect((await deps.store.get("2026-09-26-explainer-abc123"))?.status).toBe("pending");
    expect((await deps.store.get("2026-09-26-explainer-abc123"))?.error).toBe(HASH_MISMATCH_NOTE);
    expect(first.skipped).toContainEqual({
      draftId: "2026-09-26-explainer-abc123",
      reason: "hash-mismatch",
    });
    expect(discord.notices).toHaveLength(1);
    expect(discord.notices[0]).toContain("the draft changed since the approval");

    await runPublisher(deps);
    expect(discord.notices).toHaveLength(1);
  });
});

describe("expiry", () => {
  it("expires a draft whose moment has passed and says so once", async () => {
    const { deps, discord, instagram } = setup();
    await deps.store.save(approvedDraft({ id: "late", publishBy: "2026-09-26T20:00:00.000Z" }));
    await deps.store.save(
      approvedDraft({ id: "waiting", status: "pending", publishBy: "2026-09-26T20:00:00.000Z" }),
    );

    const report = await runPublisher(deps);

    expect((await deps.store.get("late"))?.status).toBe("expired");
    expect((await deps.store.get("waiting"))?.status).toBe("expired");
    expect(report.skipped).toContainEqual({ draftId: "late", reason: "expired" });
    expect(instagram.calls).toEqual([]);
    expect(discord.notices.filter((n) => n.startsWith("⌛"))).toHaveLength(2);

    discord.notices.length = 0;
    await runPublisher(deps);
    expect(discord.notices).toEqual([]);
  });

  it("publishes a draft that is exactly one minute short of expiring", async () => {
    const { deps } = setup();
    await deps.store.save(
      approvedDraft({ publishBy: "2026-09-26T22:06:00.000Z", slides: sampleSlides(1) }),
    );
    const report = await runPublisher(deps);
    expect(report.posts).toHaveLength(1);
  });
});

describe("the quota", () => {
  it("skips the draft when the day's posts are used up", async () => {
    const { deps, instagram } = setup({ instagram: fakeInstagram({ quota: { used: 50, total: 50 } }) });
    await deps.store.save(approvedDraft());

    const report = await runPublisher(deps);

    expect(report.skipped).toContainEqual({
      draftId: "2026-09-26-explainer-abc123",
      reason: "quota-exhausted",
    });
    expect(report.posts).toEqual([]);
    expect(instagram.calls).toEqual(["quota"]);
    expect((await deps.store.get("2026-09-26-explainer-abc123"))?.status).toBe("approved");
  });
});

describe("the access token", () => {
  const tokenAt = (obtainedAt: string): TokenRecord => ({
    token: "old-token",
    obtainedAt,
    expiresAt: "2026-10-01T00:00:00.000Z",
  });

  it("leaves a young token alone", async () => {
    const { deps, instagram } = setup();
    await writeTokenFile(deps.tokenFile, tokenAt("2026-09-01T22:05:00.000Z")); // 25 days old
    const report = await runPublisher(deps);
    expect(instagram.calls).not.toContain("refreshToken");
    expect(report.tokenRefreshed).toBeUndefined();
  });

  it("refreshes a token on its fifty-first day", async () => {
    const { deps, instagram } = setup();
    await writeTokenFile(deps.tokenFile, tokenAt("2026-08-06T22:05:00.000Z")); // 51 days old

    const report = await runPublisher(deps);

    expect(instagram.calls).toContain("refreshToken");
    expect(report.tokenRefreshed).toBe(true);
    const stored: unknown = JSON.parse(await readFile(deps.tokenFile, "utf8"));
    expect(stored).toEqual({
      token: "fresh-token",
      obtainedAt: NOW.toISOString(),
      expiresAt: "2026-11-25T22:05:00.000Z",
    });
  });

  it("warns and keeps working with the old token when the refresh fails", async () => {
    const { deps, discord } = setup({
      instagram: fakeInstagram({
        refresh: async () => {
          throw new Error("Meta returned 400");
        },
      }),
    });
    await writeTokenFile(deps.tokenFile, tokenAt("2026-08-06T22:05:00.000Z"));
    await deps.store.save(approvedDraft({ slides: sampleSlides(1) }));

    const report = await runPublisher(deps);

    expect(report.tokenRefreshed).toBeUndefined();
    expect(discord.notices[0]).toContain("could not be refreshed");
    expect(discord.notices[0]).toContain("Meta returned 400");
    expect(report.posts).toHaveLength(1);
    const stored = await readFile(deps.tokenFile, "utf8");
    expect(stored).toContain("old-token");
  });

  it("says nothing when there is no token file yet", async () => {
    const { deps, discord, instagram } = setup();
    const report = await runPublisher(deps);
    expect(instagram.calls).not.toContain("refreshToken");
    expect(discord.notices).toEqual([]);
    expect(report.failed).toEqual([]);
  });
});

describe("reconciling an interrupted publish", () => {
  const crashed = (publish: NonNullable<Draft["publish"]>, overrides: Partial<Draft> = {}): Draft =>
    approvedDraft({ status: "publishing", publish, ...overrides });

  it("finishes a publish that crashed after the children were created", async () => {
    const { deps, instagram, imagehost } = setup();
    const draft = crashed({
      imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
      containerIds: ["container-1", "container-2"],
    });
    await deps.store.save(draft);

    const report = await runPublisher(deps);

    expect(instagram.calls).toEqual([
      "containerStatus:container-1",
      "containerStatus:container-2",
      "createCarouselContainer:container-1,container-2",
      "publish:carousel-1",
    ]);
    expect(imagehost.published).toEqual([]);
    expect((await deps.store.get(draft.id))?.status).toBe("published");
    expect(report.posts).toHaveLength(1);
  });

  it("publishes a recorded parent exactly once", async () => {
    const { deps, instagram } = setup({ instagram: fakeInstagram({ statuses: ["FINISHED"] }) });
    const draft = crashed({
      imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
      containerIds: ["container-1", "container-2"],
      carouselId: "carousel-1",
    });
    await deps.store.save(draft);

    await runPublisher(deps);

    expect(instagram.calls.filter((c) => c.startsWith("createCarouselContainer"))).toEqual([]);
    expect(instagram.calls.filter((c) => c.startsWith("publish:"))).toEqual(["publish:carousel-1"]);
    expect((await deps.store.get(draft.id))?.publish?.mediaId).toBe("media-1");
  });

  it("marks a draft published without publishing again when a media id is on record", async () => {
    const { deps, instagram, imagehost, discord } = setup();
    const draft = crashed({
      imageUrls: ["https://pages.test/a.jpg"],
      containerIds: ["container-1"],
      carouselId: "carousel-1",
      mediaId: "media-9",
      permalink: "https://instagram.test/p/9",
    });
    await deps.store.save(draft);

    const report = await runPublisher(deps);

    expect(instagram.calls.filter((c) => c.startsWith("publish:"))).toEqual([]);
    expect((await deps.store.get(draft.id))?.status).toBe("published");
    expect(imagehost.removed).toEqual([[`${draft.id}-1.jpg`, `${draft.id}-2.jpg`]]);
    expect(report.posts[0]?.mediaId).toBe("media-9");
    expect(discord.notices[0]).toContain("https://instagram.test/p/9");
  });

  it("hands a dead parent container back to the queue with its ids cleared", async () => {
    const { deps, instagram } = setup({ instagram: fakeInstagram({ statuses: ["ERROR"] }) });
    const draft = crashed({
      imageUrls: ["https://pages.test/a.jpg"],
      containerIds: ["container-1"],
      carouselId: "carousel-1",
    });
    await deps.store.save(draft);

    const report = await runPublisher(deps);

    // Reconciliation resets it; the same run then picks it up as approved.
    expect(report.skipped.some((s) => s.reason.startsWith("restarted:"))).toBe(true);
    expect(instagram.calls).toContain("quota");
    const saved = await deps.store.get(draft.id);
    expect(saved?.status).toBe("published");
    expect(saved?.publish?.carouselId).toBe("carousel-1");
    expect(saved?.publish?.containerIds).toEqual(["container-1", "container-2"]);
  });

  it("reconciles even before the publish window opens", async () => {
    const { deps, instagram } = setup({ now: () => MORNING });
    await deps.store.save(
      crashed({
        imageUrls: ["https://pages.test/a.jpg", "https://pages.test/b.jpg"],
        containerIds: ["container-1", "container-2"],
      }),
    );

    const report = await runPublisher(deps);

    expect(report.windowOpen).toBe(false);
    expect(report.posts).toHaveLength(1);
    expect(instagram.calls).not.toContain("quota");
  });
});
