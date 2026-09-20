/**
 * The publisher: everything that stands between an approved draft and a post.
 *
 * It runs every fifteen minutes and on wake, and each run does the same five
 * things before it publishes anything — refresh the token if it is old, expire
 * drafts whose moment has passed, collect verdicts, finish any publish a
 * previous run was interrupted in the middle of, and check the clock. Only
 * then does it publish, one approved draft at a time, oldest first.
 *
 * The publish itself is a state machine (`./machine.ts`); this file is the
 * driver that executes its commands against the ports and writes down every
 * id Instagram hands back *before* the next call, so a crash is always
 * recoverable. It never throws: a bad draft is marked failed and the run
 * carries on.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  Clock,
  DiscordPort,
  DraftStore,
  ImageHostPort,
  InstagramPort,
  PublishReport,
} from "../newsroom/ports.js";
import type { Draft, Post } from "../newsroom/types.js";
import { DAY_MS, localHour } from "../newsroom/time.js";
import {
  next,
  resume,
  type AnyEvent,
  type Command,
  type ContainerStatus,
  type State,
} from "./machine.js";

export type PublisherDeps = {
  now: Clock;
  store: DraftStore;
  discord: DiscordPort;
  imagehost: ImageHostPort;
  instagram: InstagramPort;
  sleep?: (ms: number) => Promise<void>;
  /** JSON file holding the long-lived Instagram token and when it was issued. */
  tokenFile: string;
  /** Local hour the publish window opens. */
  windowStartHour?: number;
  shareChecklist?: string;
};

export const DEFAULT_WINDOW_START_HOUR = 15;

/** Meta's long-lived tokens last 60 days; refresh at 50 and there is room to fail. */
export const TOKEN_REFRESH_AFTER_DAYS = 50;

export const DEFAULT_SHARE_CHECKLIST = [
  "Share to your story, then ask two officers to do the same.",
  "Send the link to the club group chat and the class Discord.",
  "Reply to every comment today.",
].join("\n");

/** The marker that keeps a mismatched approval from being reported every run. */
export const HASH_MISMATCH_NOTE = "approval does not match the current content hash";

/**
 * A verdict binds to the content the approver saw: the card prints the first
 * 12 characters of the content hash and the verdict carries them back. A full
 * hash also matches; anything shorter or different does not.
 */
export function verdictMatches(contentHash: string, verdict: { contentHash: string }): boolean {
  const ref = verdict.contentHash;
  return ref.length >= 12 && contentHash.startsWith(ref);
}

export type TokenRecord = { token: string; obtainedAt: string; expiresAt: string };

export async function readTokenFile(path: string): Promise<TokenRecord | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    const record = raw as Partial<TokenRecord>;
    if (typeof record.token !== "string" || typeof record.obtainedAt !== "string") return undefined;
    return { token: record.token, obtainedAt: record.obtainedAt, expiresAt: record.expiresAt ?? "" };
  } catch {
    return undefined;
  }
}

export async function writeTokenFile(path: string, record: TokenRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Drops the publish record, so an abandoned attempt starts clean next time. */
function withoutPublishRecord(draft: Draft): Draft {
  const { publish: _discarded, ...rest } = draft;
  return rest;
}

export async function runPublisher(deps: PublisherDeps): Promise<PublishReport> {
  const {
    now: clock,
    store,
    discord,
    imagehost,
    instagram,
    sleep = realSleep,
    tokenFile,
    windowStartHour = DEFAULT_WINDOW_START_HOUR,
    shareChecklist = DEFAULT_SHARE_CHECKLIST,
  } = deps;

  const now = clock();
  const report: PublishReport = {
    at: now.toISOString(),
    windowOpen: false,
    considered: 0,
    posts: [],
    skipped: [],
    failed: [],
  };

  const notify = async (text: string): Promise<void> => {
    try {
      await discord.notify(text);
    } catch {
      // A silent Discord must not stop a publish.
    }
  };

  const guard = async (step: string, work: () => Promise<void>): Promise<void> => {
    try {
      await work();
    } catch (error) {
      report.failed.push({ draftId: "-", step, message: messageOf(error) });
      await notify(`⚠️ Publisher failed at **${step}**: ${messageOf(error)}`);
    }
  };

  // 1. The token. Sixty days is the life of a long-lived token; at fifty it is
  //    replaced, and if that fails the old one is still good for ten days.
  await guard("token", async () => {
    const record = await readTokenFile(tokenFile);
    if (!record) return;
    const age = now.getTime() - Date.parse(record.obtainedAt);
    if (!Number.isFinite(age) || age < TOKEN_REFRESH_AFTER_DAYS * DAY_MS) return;
    try {
      const refreshed = await instagram.refreshToken();
      await writeTokenFile(tokenFile, {
        token: refreshed.token,
        obtainedAt: now.toISOString(),
        expiresAt: refreshed.expiresAt,
      });
      report.tokenRefreshed = true;
    } catch (error) {
      await notify(
        `⚠️ The Instagram token could not be refreshed: ${messageOf(error)}\nIt was issued ${record.obtainedAt} and expires ${record.expiresAt || "unknown"}. Generate a new one in the Meta app dashboard before it does.`,
      );
    }
  });

  // 2. Expiry. A draft nobody answered in time is never published late.
  await guard("expire", async () => {
    for (const draft of await store.list({ status: ["pending", "approved"] })) {
      if (now.getTime() < Date.parse(draft.publishBy)) continue;
      await store.transition(draft.id, draft.status, "expired");
      report.skipped.push({ draftId: draft.id, reason: "expired" });
      await notify(
        `⌛ Expired: ${draft.id} (${draft.assignment.pillar}) was not published by ${draft.publishBy}.`,
      );
    }
  });

  // 3. Verdicts. An approval binds to the content hash it was given.
  await guard("verdicts", async () => {
    for (const draft of await store.list({ status: "pending" })) {
      const verdict = await discord.readVerdict(draft);
      if (!verdict) continue;
      if (verdict.decision === "rejected") {
        await store.transition(draft.id, "pending", "rejected", { verdict });
        report.skipped.push({ draftId: draft.id, reason: "rejected" });
        continue;
      }
      if (verdictMatches(draft.contentHash, verdict)) {
        await store.transition(draft.id, "pending", "approved", { verdict });
        continue;
      }
      report.skipped.push({ draftId: draft.id, reason: "hash-mismatch" });
      if (draft.error === HASH_MISMATCH_NOTE) continue;
      await store.save({ ...draft, error: HASH_MISMATCH_NOTE });
      await notify(
        `⚠️ ${draft.id} was approved, but the draft changed since the approval. It stays pending. Re-post the card and approve the new one.`,
      );
    }
  });

  const ctx: PublishContext = {
    store,
    discord,
    imagehost,
    instagram,
    sleep,
    notify,
    shareChecklist,
    now,
    report,
  };

  // 4. Reconciliation before any new work: finish what a crashed run started.
  await guard("reconcile", async () => {
    for (const draft of await store.list({ status: "publishing" })) {
      report.considered += 1;
      await publishOne(draft, ctx);
    }
  });

  // 5. The publish window. Before it opens the run is only housekeeping.
  if (localHour(now) < windowStartHour) return report;
  report.windowOpen = true;

  // 6. The approved drafts, oldest first.
  const approved = (await store.list({ status: "approved" })).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  for (const draft of approved) {
    let quota: { used: number; total: number };
    try {
      quota = await instagram.quota();
    } catch (error) {
      report.failed.push({ draftId: draft.id, step: "quota", message: messageOf(error) });
      await notify(`⚠️ Publisher could not read the Instagram quota: ${messageOf(error)}`);
      break;
    }
    if (quota.used >= quota.total) {
      report.skipped.push({ draftId: draft.id, reason: "quota-exhausted" });
      continue;
    }

    report.considered += 1;
    let publishing: Draft;
    try {
      publishing = await store.transition(draft.id, "approved", "publishing");
    } catch (error) {
      report.failed.push({ draftId: draft.id, step: "transition", message: messageOf(error) });
      continue;
    }
    await publishOne(publishing, ctx);
  }

  return report;
}

type PublishContext = {
  store: DraftStore;
  discord: DiscordPort;
  imagehost: ImageHostPort;
  instagram: InstagramPort;
  sleep: (ms: number) => Promise<void>;
  notify: (text: string) => Promise<void>;
  shareChecklist: string;
  now: Date;
  report: PublishReport;
};

const LOOP_LIMIT = 4 * 60 + 40;

/** Runs the machine for one draft against the ports. Never throws. */
async function publishOne(start: Draft, ctx: PublishContext): Promise<void> {
  let draft = start;
  let step = "resume";

  const patch = async (publish: NonNullable<Draft["publish"]>): Promise<void> => {
    draft = { ...draft, publish };
    await ctx.store.save(draft);
  };
  const record = (): NonNullable<Draft["publish"]> =>
    draft.publish ?? { imageUrls: [], containerIds: [] };

  const execute = async (commands: Command[], state: State): Promise<AnyEvent | undefined> => {
    let event: AnyEvent | undefined;
    for (const command of commands) {
      step = command.type;
      switch (command.type) {
        case "hostImages": {
          const urls = await ctx.imagehost.publish(command.files);
          event = { type: "hosted", urls };
          break;
        }
        case "saveImageUrls":
          await patch({ ...record(), imageUrls: command.urls });
          break;
        case "waitServed":
          await ctx.imagehost.waitUntilServed(command.urls);
          event = { type: "served" };
          break;
        case "createSingle": {
          const { id } = await ctx.instagram.createImageContainer({
            imageUrl: command.imageUrl,
            caption: command.caption,
          });
          event = { type: "container", id };
          break;
        }
        case "createChild": {
          const { id } = await ctx.instagram.createImageContainer({
            imageUrl: command.imageUrl,
            isCarouselItem: true,
          });
          event = { type: "container", id };
          break;
        }
        case "saveContainerIds":
          await patch({ ...record(), containerIds: command.ids });
          break;
        case "sleep":
          await ctx.sleep(command.ms);
          break;
        case "pollChildren": {
          const statuses: ContainerStatus[] = [];
          for (const id of command.ids) statuses.push(await ctx.instagram.containerStatus(id));
          event = { type: "statuses", statuses };
          break;
        }
        case "pollContainer":
          event = { type: "status", status: await ctx.instagram.containerStatus(command.id) };
          break;
        case "createCarousel": {
          const { id } = await ctx.instagram.createCarouselContainer({
            children: command.children,
            caption: command.caption,
          });
          event = { type: "container", id };
          break;
        }
        case "saveCarouselId":
          await patch({ ...record(), carouselId: command.id });
          break;
        case "publish": {
          const result = await ctx.instagram.publish(command.containerId);
          event = {
            type: "publishedOk",
            mediaId: result.mediaId,
            ...(result.permalink === undefined ? {} : { permalink: result.permalink }),
          };
          break;
        }
        case "markPublished": {
          const published: NonNullable<Draft["publish"]> = {
            ...record(),
            ...(command.mediaId === undefined ? {} : { mediaId: command.mediaId }),
            ...(command.permalink === undefined ? {} : { permalink: command.permalink }),
          };
          draft = await ctx.store.transition(draft.id, "publishing", "published", {
            publish: published,
          });
          const mediaId = published.mediaId;
          if (mediaId) {
            const post: Post = {
              draftId: draft.id,
              mediaId,
              ...(published.permalink === undefined ? {} : { permalink: published.permalink }),
              publishedAt: ctx.now.toISOString(),
            };
            ctx.report.posts.push(post);
          } else {
            ctx.report.skipped.push({ draftId: draft.id, reason: "already-published" });
          }
          break;
        }
        case "removeImages":
          await ctx.imagehost.remove(command.names);
          break;
        case "announce": {
          const link = command.permalink ?? command.mediaId ?? draft.id;
          await ctx.notify(`✅ Published: ${link}\n${ctx.shareChecklist}`);
          break;
        }
        case "markFailed": {
          draft = await ctx.store.transition(draft.id, "publishing", "failed", {
            error: command.message,
          });
          ctx.report.failed.push({ draftId: draft.id, step: state.phase, message: command.message });
          await ctx.notify(`❌ ${draft.id} failed to publish: ${command.message}`);
          break;
        }
        case "reset": {
          await ctx.store.save(withoutPublishRecord(draft));
          draft = await ctx.store.transition(draft.id, "publishing", "approved");
          ctx.report.skipped.push({ draftId: draft.id, reason: `restarted: ${command.reason}` });
          break;
        }
      }
    }
    return event;
  };

  try {
    let current = next(resume(draft, ctx.now), { type: "begin" });
    for (let turn = 0; turn < LOOP_LIMIT; turn += 1) {
      const event = await execute(current.commands, current.state);
      if (!event) return;
      current = next(current.state, event);
    }
    throw new Error("the publish did not settle");
  } catch (error) {
    const message = messageOf(error);
    ctx.report.failed.push({ draftId: draft.id, step, message });
    if (draft.status === "publishing") {
      try {
        await ctx.store.transition(draft.id, "publishing", "failed", { error: message });
      } catch {
        // Already moved on; the report is the record.
      }
    }
    await ctx.notify(`❌ ${draft.id} failed to publish at **${step}**: ${message}`);
  }
}
