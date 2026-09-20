/**
 * Discord adapter. Posts the draft card into the approval channel, reads the
 * verdict back off the emoji reactions, and sends plain notices.
 *
 * Everything goes over Discord REST v10 with the injected `fetch`; there is no
 * gateway connection, because the Mac sleeps (panel verdict, point 3).
 *
 * Endpoints (https://docs.discord.com/developers/resources/message):
 *   POST   /channels/{channel.id}/messages                                  (multipart: payload_json + files[n])
 *   PUT    /channels/{channel.id}/messages/{message.id}/reactions/{emoji}/@me
 *   GET    /channels/{channel.id}/messages/{message.id}/reactions/{emoji}?limit=100
 * Rate limits: a 429 body carries `retry_after` in seconds
 * (https://docs.discord.com/developers/topics/rate-limits).
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Clock, DiscordPort, Fetch } from "../newsroom/ports.js";
import { TZ } from "../newsroom/time.js";
import type { Draft, Slide, Verdict } from "../newsroom/types.js";

const DEFAULT_API_BASE = "https://discord.com/api/v10";
/** Discord's own limit on message content. */
const MAX_CONTENT = 2000;
/** Notices are chunked well below the limit so nothing is ever refused. */
const NOTIFY_CHUNK = 1900;
/** A draft is a carousel: ten slides at most. */
const MAX_FILES = 10;

export const APPROVE = "✅";
export const REJECT = "❌";
/** How much of the content hash the card prints, so a verdict can be matched to what was seen. */
export const HASH_REF_LENGTH = 12;
const HASH_REF = /\bref ([A-Za-z0-9-]{6,64})\b/;
const REACT_LINE = `React ${APPROVE} to approve (this means you checked every flag) or ${REJECT} to reject.`;

export class DiscordError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(what: string, status: number, body: string) {
    super(`Discord ${what} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "DiscordError";
    this.status = status;
    this.body = body;
  }
}

export type DiscordConfig = {
  token: string;
  channelId: string;
  /** Discord user ids allowed to give a verdict. Everyone else is ignored. */
  approvers: readonly string[];
  fetch: Fetch;
  /** Seams for tests; production leaves these alone. */
  apiBase?: string;
  now?: Clock;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** "Sat Sep 26, 3:00pm PT" — the time an approver actually reads. */
export function formatPublishBy(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const period = get("dayPeriod").toLowerCase().replace(/[^a-z]/g, "");
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("hour")}:${get("minute")}${period} PT`;
}

/**
 * The card an approver reads. Order is fixed: what and when, the headline, the
 * flags they are confirming, the caption in a code block so one tap copies it,
 * the hashtags, and the instruction. The caption is the only part that gives
 * way when the 2000 character limit is close.
 */
export function buildCardContent(draft: Draft): string {
  const { assignment, text } = draft;
  const head = `\u{1F4DD} Draft for ${assignment.date} · ${assignment.pillar} · publish by ${formatPublishBy(draft.publishBy)}`;
  const flagLines =
    text.flags.length > 0 ? ["**⚠️ FLAGS:**", ...text.flags.map((f) => `**${f}**`)] : [];
  const hashtags = text.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  const before = [head, text.headline, ...flagLines, "```text"];
  const after = ["```", hashtags, REACT_LINE, `ref ${draft.contentHash.slice(0, HASH_REF_LENGTH)}`];

  const budget = MAX_CONTENT - 1 - [...before, "", ...after].join("\n").length;
  let caption = text.caption;
  if (caption.length > budget) caption = `${caption.slice(0, Math.max(0, budget - 1))}…`;

  const content = [...before, caption, ...after].join("\n");
  return content.length < MAX_CONTENT ? content : `${content.slice(0, MAX_CONTENT - 2)}…`;
}

export function createDiscord(cfg: DiscordConfig): DiscordPort {
  const apiBase = cfg.apiBase ?? DEFAULT_API_BASE;
  const sleep = cfg.sleep ?? wait;
  const now = cfg.now ?? ((): Date => new Date());

  async function send(
    what: string,
    method: string,
    path: string,
    init?: { body?: BodyInit; contentType?: string },
  ): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bot ${cfg.token}` };
    if (init?.contentType) headers["content-type"] = init.contentType;
    const call = (): Promise<Response> =>
      cfg.fetch(`${apiBase}${path}`, {
        method,
        headers,
        ...(init?.body === undefined ? {} : { body: init.body }),
      });

    let res = await call();
    if (res.status === 429) {
      await sleep(await retryAfterMs(res));
      res = await call();
    }
    if (!res.ok) throw new DiscordError(what, res.status, await res.text().catch(() => ""));
    return res;
  }

  /** The hash reference printed on the card the approver reacted to; "" if the message has none. */
  async function hashRefOn(messageId: string): Promise<string> {
    const res = await send("get message", "GET", `/channels/${cfg.channelId}/messages/${messageId}`);
    const message = (await res.json()) as { content?: unknown };
    const content = typeof message.content === "string" ? message.content : "";
    return HASH_REF.exec(content)?.[1] ?? "";
  }

  async function reactors(messageId: string, emoji: string): Promise<string[]> {
    const path = `/channels/${cfg.channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}?limit=100`;
    const res = await send("get reactions", "GET", path);
    const users: unknown = await res.json();
    if (!Array.isArray(users)) return [];
    return (users as { id?: unknown; bot?: unknown }[])
      .filter((u) => u.bot !== true && typeof u.id === "string" && cfg.approvers.includes(u.id))
      .map((u) => u.id as string);
  }

  return {
    async postDraft(draft: Draft, slides: Slide[]): Promise<{ messageId: string }> {
      const files = slides.slice(0, MAX_FILES);
      const form = new FormData();
      const attachments: { id: number; filename: string }[] = [];
      for (const [i, slide] of files.entries()) {
        const filename = basename(slide.path);
        const bytes = await readFile(slide.path);
        form.append(`files[${i}]`, new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), filename);
        attachments.push({ id: i, filename });
      }
      form.append(
        "payload_json",
        JSON.stringify({
          content: buildCardContent(draft),
          attachments,
          allowed_mentions: { parse: [] },
        }),
      );

      // No content-type: fetch writes the multipart boundary itself.
      const res = await send("post draft", "POST", `/channels/${cfg.channelId}/messages`, { body: form });
      const message = (await res.json()) as { id?: string };
      if (!message.id) throw new DiscordError("post draft", res.status, "response had no message id");

      for (const emoji of [APPROVE, REJECT]) {
        await send(
          "add reaction",
          "PUT",
          `/channels/${cfg.channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/@me`,
        );
      }
      return { messageId: message.id };
    },

    async readVerdict(draft: Draft): Promise<Verdict | undefined> {
      const messageId = draft.discordMessageId;
      if (!messageId) throw new Error(`draft ${draft.id} has no discordMessageId; post it first`);
      const at = now().toISOString();

      // A rejection wins, so it is read first and answered without asking further.
      const rejectedBy = (await reactors(messageId, REJECT))[0];
      if (rejectedBy) {
        return { decision: "rejected", by: rejectedBy, at, contentHash: await hashRefOn(messageId) };
      }
      const approvedBy = (await reactors(messageId, APPROVE))[0];
      if (approvedBy) {
        return { decision: "approved", by: approvedBy, at, contentHash: await hashRefOn(messageId) };
      }
      return undefined;
    },

    async notify(text: string): Promise<void> {
      for (let i = 0; i < Math.max(text.length, 1); i += NOTIFY_CHUNK) {
        const chunk = text.slice(i, i + NOTIFY_CHUNK);
        await send("notify", "POST", `/channels/${cfg.channelId}/messages`, {
          contentType: "application/json",
          body: JSON.stringify({ content: chunk, allowed_mentions: { parse: [] } }),
        });
      }
    },
  };
}

/** Discord reports `retry_after` in seconds, in the body and in the header. */
async function retryAfterMs(res: Response): Promise<number> {
  const header = Number(res.headers.get("retry-after"));
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { retry_after?: number };
    if (typeof body.retry_after === "number") return Math.ceil(body.retry_after * 1000);
  } catch {
    // fall through to the header
  }
  return Number.isFinite(header) && header > 0 ? Math.ceil(header * 1000) : 1000;
}
