import { describe, expect, it } from "vitest";
import type { Draft } from "../newsroom/types.js";
import { buildCardContent, createDiscord } from "./index.js";

const HASH_SEEN = "abcdef123456" + "0".repeat(52);
const HASH_NOW = "ffffff000000" + "0".repeat(52);

function draft(patch: Partial<Draft>): Draft {
  return {
    id: "2026-09-26-explainer-abcdef",
    assignment: { date: "2026-09-26", pillar: "explainer", angle: "welcome" },
    text: {
      headline: "We build rockets",
      slides: [{ title: "We build rockets", body: "From Los Altos." }],
      caption: "We build rockets.\n\nSource: LAHS Rocket Club.",
      sourceLine: "Source: LAHS Rocket Club.",
      hashtags: ["rocketry", "lahs", "bayarea", "stem", "space"],
      flags: [],
    },
    slides: [],
    contentHash: HASH_SEEN,
    createdAt: "2026-09-25T03:30:00.000Z",
    publishBy: "2026-09-27T18:59:59.000Z",
    status: "pending",
    ...patch,
  };
}

describe("an approval binds to the content the approver saw", () => {
  it("the card carries the first 12 characters of the content hash", () => {
    expect(buildCardContent(draft({}))).toContain("ref abcdef123456");
  });

  it("a verdict carries the hash printed on the message, not the draft's current hash", async () => {
    const fetch = (async (input: unknown) => {
      const url = decodeURIComponent(typeof input === "string" ? input : String(input));
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/users/@me")) return json({ id: "bot" });
      if (url.includes("/reactions/")) return json(url.includes("❌") ? [] : [{ id: "bot" }, { id: "officer" }]);
      if (url.endsWith("/messages/m")) return json({ id: "m", content: `${buildCardContent(draft({}))}` });
      return new Response("not found", { status: 404 });
    }) as typeof globalThis.fetch;

    const discord = createDiscord({ token: "t", channelId: "c", approvers: ["officer"], fetch });
    const changed = draft({ contentHash: HASH_NOW, discordMessageId: "m" });
    const verdict = await discord.readVerdict(changed);

    expect(verdict?.decision).toBe("approved");
    expect(verdict?.by).toBe("officer");
    expect(verdict?.contentHash).toBe("abcdef123456");
  });
});
