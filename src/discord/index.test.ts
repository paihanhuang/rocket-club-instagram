import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Fetch } from "../newsroom/ports.js";
import type { Draft, Slide } from "../newsroom/types.js";
import { createDiscord, DiscordError } from "./index.js";

/** A 1x1 JPEG, so slide files on disk are real images. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

function recorder(handle: (req: Recorded, n: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fake = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const rec: Recorded = { url, method: init?.method ?? "GET", headers, body: init?.body };
    calls.push(rec);
    return handle(rec, calls.length - 1);
  };
  return { calls, fetch: fake as unknown as Fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const dirs: string[] = [];
async function slideFiles(count: number): Promise<Slide[]> {
  const dir = await mkdtemp(join(tmpdir(), "slides-"));
  dirs.push(dir);
  const slides: Slide[] = [];
  for (let i = 0; i < count; i++) {
    const path = join(dir, `slide-${i + 1}.jpg`);
    await writeFile(path, TINY_JPEG);
    slides.push({ path, width: 1080, height: 1350 });
  }
  return slides;
}
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

function makeDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: "2026-09-26-launches",
    assignment: { date: "2026-09-26", pillar: "launches", angle: "how to watch it live" },
    text: {
      headline: "Falcon 9 lifts off from Vandenberg on Saturday",
      slides: [{ title: "Liftoff", body: "The window opens at 3pm." }],
      caption: "A rocket goes up from Vandenberg this Saturday and you can see it from Los Altos.",
      sourceLine: "Source: Launch Library 2",
      hashtags: ["rockets", "spacex", "bayarea", "losaltos", "stem"],
      flags: [],
    },
    slides: [],
    contentHash: "hash-abc",
    createdAt: "2026-09-25T02:00:00.000Z",
    publishBy: "2026-09-26T22:00:00.000Z",
    status: "pending",
    ...over,
  };
}

const CONFIG = { token: "bot-token", channelId: "chan-1", approvers: ["u-president", "u-officer"] };
const CHECK = encodeURIComponent("✅");
const CROSS = encodeURIComponent("❌");

const payloadOf = (rec: Recorded): { content: string; attachments: { id: number; filename: string }[] } => {
  const form = rec.body as FormData;
  return JSON.parse(String(form.get("payload_json")));
};

describe("postDraft", () => {
  it("posts multipart with payload_json and one files[n] part per slide, then adds both reactions", async () => {
    const slides = await slideFiles(3);
    const r = recorder((req) =>
      req.method === "POST" ? json({ id: "msg-9" }) : new Response(null, { status: 204 }),
    );
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });

    const out = await discord.postDraft(makeDraft(), slides);

    expect(out).toEqual({ messageId: "msg-9" });
    expect(r.calls).toHaveLength(3);

    const post = r.calls[0]!;
    expect(post.url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect(post.method).toBe("POST");
    expect(post.headers["authorization"]).toBe("Bot bot-token");
    // fetch must set the multipart boundary itself
    expect(post.headers["content-type"]).toBeUndefined();

    const form = post.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("payload_json")).toBeTypeOf("string");
    for (let i = 0; i < 3; i++) {
      const part = form.get(`files[${i}]`);
      expect(part, `files[${i}]`).toBeInstanceOf(Blob);
      expect((part as File).name).toBe(`slide-${i + 1}.jpg`);
      expect((part as Blob).size).toBe(TINY_JPEG.byteLength);
    }
    expect(form.get("files[3]")).toBeNull();
    expect(payloadOf(post).attachments).toEqual([
      { id: 0, filename: "slide-1.jpg" },
      { id: 1, filename: "slide-2.jpg" },
      { id: 2, filename: "slide-3.jpg" },
    ]);

    expect(r.calls[1]).toMatchObject({
      method: "PUT",
      url: `https://discord.com/api/v10/channels/chan-1/messages/msg-9/reactions/${CHECK}/@me`,
    });
    expect(r.calls[2]).toMatchObject({
      method: "PUT",
      url: `https://discord.com/api/v10/channels/chan-1/messages/msg-9/reactions/${CROSS}/@me`,
    });
  });

  it("writes the card in order: header, headline, caption code block, hashtags, react line", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await discord.postDraft(makeDraft(), await slideFiles(1));

    const content = payloadOf(r.calls[0]!).content;
    const lines = content.split("\n");
    expect(lines[0]).toBe("\u{1F4DD} Draft for 2026-09-26 · launches · publish by Sat Sep 26, 3:00pm PT");
    expect(lines[1]).toBe("Falcon 9 lifts off from Vandenberg on Saturday");
    expect(content).not.toContain("FLAGS");
    expect(content).toContain(
      "```text\nA rocket goes up from Vandenberg this Saturday and you can see it from Los Altos.\n```",
    );
    expect(content).toContain("\n#rockets #spacex #bayarea #losaltos #stem\n");
    expect(lines.at(-1)).toBe(
      "React ✅ to approve (this means you checked every flag) or ❌ to reject.",
    );
    expect(content.indexOf("```text")).toBeGreaterThan(content.indexOf("Falcon 9"));
    expect(content.indexOf("#rockets")).toBeGreaterThan(content.indexOf("```text"));
  });

  it("puts every flag on its own bold line above the caption", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    const draft = makeDraft();
    draft.text.flags = ["confirm the launch time before posting", "no licensed photo"];
    await discord.postDraft(draft, await slideFiles(1));

    const content = payloadOf(r.calls[0]!).content;
    expect(content).toContain("**⚠️ FLAGS:**\n**confirm the launch time before posting**\n**no licensed photo**");
    expect(content.indexOf("FLAGS")).toBeLessThan(content.indexOf("```text"));
  });

  it("keeps the message under 2000 characters by truncating the caption with an ellipsis", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    const draft = makeDraft();
    draft.text.caption = "x".repeat(3000);
    await discord.postDraft(draft, await slideFiles(1));

    const content = payloadOf(r.calls[0]!).content;
    expect(content.length).toBeLessThan(2000);
    expect(content).toContain("…\n```");
    expect(content.endsWith("React ✅ to approve (this means you checked every flag) or ❌ to reject.")).toBe(
      true,
    );
    expect(content).toContain("#rockets");
  });

  it("uploads at most ten slides", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await discord.postDraft(makeDraft(), await slideFiles(12));

    const form = r.calls[0]!.body as FormData;
    expect(form.get("files[9]")).not.toBeNull();
    expect(form.get("files[10]")).toBeNull();
    expect(payloadOf(r.calls[0]!).attachments).toHaveLength(10);
  });
});

describe("readVerdict", () => {
  const draft = makeDraft({ discordMessageId: "msg-9" });
  const reactionUrl = (emoji: string) =>
    `https://discord.com/api/v10/channels/chan-1/messages/msg-9/reactions/${emoji}?limit=100`;

  it("approves when a listed approver reacted, ignoring the bot's own reaction", async () => {
    const r = recorder((req) =>
      req.url.includes(CROSS)
        ? json([{ id: "bot-self", bot: true }])
        : json([{ id: "bot-self", bot: true }, { id: "u-officer", username: "officer" }]),
    );
    const discord = createDiscord({
      ...CONFIG,
      fetch: r.fetch,
      now: () => new Date("2026-09-26T18:30:00.000Z"),
    });

    await expect(discord.readVerdict(draft)).resolves.toEqual({
      decision: "approved",
      by: "u-officer",
      at: "2026-09-26T18:30:00.000Z",
      contentHash: "hash-abc",
    });
    expect(r.calls.map((c) => c.url)).toEqual([reactionUrl(CROSS), reactionUrl(CHECK)]);
    expect(r.calls[0]!.method).toBe("GET");
    expect(r.calls[0]!.headers["authorization"]).toBe("Bot bot-token");
  });

  it("lets a rejection from an approver beat an approval from another approver", async () => {
    const r = recorder((req) =>
      req.url.includes(CROSS) ? json([{ id: "u-president" }]) : json([{ id: "u-officer" }]),
    );
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    const verdict = await discord.readVerdict(draft);
    expect(verdict?.decision).toBe("rejected");
    expect(verdict?.by).toBe("u-president");
  });

  it("ignores reactions from people who are not approvers", async () => {
    const r = recorder(() => json([{ id: "u-stranger" }, { id: "bot-self", bot: true }]));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await expect(discord.readVerdict(draft)).resolves.toBeUndefined();
  });

  it("refuses a draft that was never posted", async () => {
    const r = recorder(() => json([]));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await expect(discord.readVerdict(makeDraft())).rejects.toThrow(/discordMessageId/);
    expect(r.calls).toHaveLength(0);
  });
});

describe("notify", () => {
  it("posts one plain message", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await discord.notify("published: https://instagram.com/p/abc");

    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]!.url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect(r.calls[0]!.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(r.calls[0]!.body))).toMatchObject({
      content: "published: https://instagram.com/p/abc",
    });
  });

  it("chunks long text at 1900 characters", async () => {
    const r = recorder(() => json({ id: "m" }));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });
    await discord.notify("y".repeat(4000));

    expect(r.calls).toHaveLength(3);
    const sent = r.calls.map((c) => JSON.parse(String(c.body)).content as string);
    expect(sent.map((s) => s.length)).toEqual([1900, 1900, 200]);
    expect(sent.join("")).toBe("y".repeat(4000));
  });
});

describe("failures", () => {
  it("retries once after a 429, waiting retry_after seconds", async () => {
    const waits: number[] = [];
    const r = recorder((_req, n) =>
      n === 0 ? json({ message: "You are being rate limited.", retry_after: 0.75, global: false }, 429) : json({ id: "m" }),
    );
    const discord = createDiscord({
      ...CONFIG,
      fetch: r.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(discord.notify("hello")).resolves.toBeUndefined();
    expect(r.calls).toHaveLength(2);
    expect(waits).toEqual([750]);
  });

  it("gives up after a second 429", async () => {
    const r = recorder(() => json({ retry_after: 0.1 }, 429));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch, sleep: async () => {} });
    await expect(discord.notify("hello")).rejects.toBeInstanceOf(DiscordError);
    expect(r.calls).toHaveLength(2);
  });

  it("throws a typed error carrying the status and body on any other failure", async () => {
    const r = recorder(() => json({ message: "Missing Access", code: 50001 }, 403));
    const discord = createDiscord({ ...CONFIG, fetch: r.fetch });

    const err = await discord.notify("hello").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DiscordError);
    expect((err as DiscordError).status).toBe(403);
    expect((err as DiscordError).body).toContain("Missing Access");
    expect((err as DiscordError).message).toMatch(/403/);
  });
});
