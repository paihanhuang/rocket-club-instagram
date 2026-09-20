import { describe, expect, it } from "vitest";
import type { Fetch } from "../newsroom/ports.js";
import { createInstagram, InstagramError } from "./index.js";

type Recorded = { url: string; method: string; headers: Record<string, string>; body: unknown };

function recorder(handle: (req: Recorded, n: number) => Response | Promise<Response>) {
  const calls: Recorded[] = [];
  const fake = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const rec: Recorded = {
      url: typeof input === "string" ? input : String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body,
    };
    calls.push(rec);
    return handle(rec, calls.length - 1);
  };
  return { calls, fetch: fake as unknown as Fetch };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const form = (rec: Recorded): URLSearchParams => new URLSearchParams(String(rec.body));
const query = (rec: Recorded): URLSearchParams => new URL(rec.url).searchParams;
const path = (rec: Recorded): string => new URL(rec.url).origin + new URL(rec.url).pathname;

const CFG = { userId: "17841400000", token: "tok-1" };
const BASE = "https://graph.instagram.com/v26.0";

describe("containers", () => {
  it("creates an image container with the image URL and the token in the form body", async () => {
    const r = recorder(() => json({ id: "cont-1" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.createImageContainer({ imageUrl: "https://pages.example/a.jpg" })).resolves.toEqual({
      id: "cont-1",
    });

    const call = r.calls[0]!;
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${BASE}/17841400000/media`);
    const body = form(call);
    expect(body.get("image_url")).toBe("https://pages.example/a.jpg");
    expect(body.get("access_token")).toBe("tok-1");
    expect(body.get("caption")).toBeNull();
    expect(body.get("is_carousel_item")).toBeNull();
    expect(body.get("media_type")).toBeNull();
  });

  it("marks a carousel child and carries a caption when asked", async () => {
    const r = recorder(() => json({ id: "cont-2" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await ig.createImageContainer({
      imageUrl: "https://pages.example/a.jpg",
      caption: "hello there",
      isCarouselItem: true,
    });

    const body = form(r.calls[0]!);
    expect(body.get("is_carousel_item")).toBe("true");
    expect(body.get("caption")).toBe("hello there");
  });

  it("creates a carousel parent from a comma separated list of children", async () => {
    const r = recorder(() => json({ id: "parent-1" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.createCarouselContainer({ children: ["a", "b", "c"], caption: "cap" })).resolves.toEqual({
      id: "parent-1",
    });

    const body = form(r.calls[0]!);
    expect(r.calls[0]!.url).toBe(`${BASE}/17841400000/media`);
    expect(body.get("media_type")).toBe("CAROUSEL");
    expect(body.get("children")).toBe("a,b,c");
    expect(body.get("caption")).toBe("cap");
    expect(body.get("access_token")).toBe("tok-1");
  });

  it("reads a container's status code", async () => {
    const r = recorder(() => json({ status_code: "FINISHED", id: "cont-1" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.containerStatus("cont-1")).resolves.toBe("FINISHED");
    const call = r.calls[0]!;
    expect(call.method).toBe("GET");
    expect(path(call)).toBe(`${BASE}/cont-1`);
    expect(query(call).get("fields")).toBe("status_code");
    expect(query(call).get("access_token")).toBe("tok-1");
    expect(call.body).toBeUndefined();
  });
});

describe("publish", () => {
  it("publishes the container and then reads the permalink", async () => {
    const r = recorder((req) => (req.method === "POST" ? json({ id: "media-77" }) : json({ permalink: "https://www.instagram.com/p/abc/", id: "media-77" })));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.publish("parent-1")).resolves.toEqual({
      mediaId: "media-77",
      permalink: "https://www.instagram.com/p/abc/",
    });

    expect(r.calls[0]!.url).toBe(`${BASE}/17841400000/media_publish`);
    expect(form(r.calls[0]!).get("creation_id")).toBe("parent-1");
    expect(form(r.calls[0]!).get("access_token")).toBe("tok-1");
    expect(path(r.calls[1]!)).toBe(`${BASE}/media-77`);
    expect(query(r.calls[1]!).get("fields")).toBe("permalink");
  });

  it("still returns the media id when the permalink lookup fails", async () => {
    const r = recorder((req) => (req.method === "POST" ? json({ id: "media-78" }) : json({ error: { message: "no", code: 100 } }, 400)));
    const ig = createInstagram({ ...CFG, fetch: r.fetch, sleep: async () => {} });

    await expect(ig.publish("parent-1")).resolves.toEqual({ mediaId: "media-78" });
  });
});

describe("account", () => {
  it("reads the publishing quota from the content_publishing_limit edge", async () => {
    const r = recorder(() => json({ data: [{ quota_usage: 3, config: { quota_total: 50, quota_duration: 86400 } }] }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.quota()).resolves.toEqual({ used: 3, total: 50 });
    const call = r.calls[0]!;
    expect(call.method).toBe("GET");
    expect(path(call)).toBe(`${BASE}/17841400000/content_publishing_limit`);
    expect(query(call).get("fields")).toBe("quota_usage,config");
  });

  it("reads the identity behind the token", async () => {
    const r = recorder(() => json({ id: "17841400000", username: "lahsrocketry" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await expect(ig.me()).resolves.toEqual({ id: "17841400000", username: "lahsrocketry" });
    expect(path(r.calls[0]!)).toBe(`${BASE}/me`);
    expect(query(r.calls[0]!).get("fields")).toBe("id,username");
  });

  it("refreshes the long lived token on the unversioned host and dates the expiry", async () => {
    const r = recorder(() => json({ access_token: "tok-2", token_type: "bearer", expires_in: 5_184_000 }));
    const ig = createInstagram({
      ...CFG,
      fetch: r.fetch,
      now: () => new Date("2026-09-19T00:00:00.000Z"),
    });

    await expect(ig.refreshToken()).resolves.toEqual({
      token: "tok-2",
      expiresAt: "2026-11-18T00:00:00.000Z",
    });

    const call = r.calls[0]!;
    expect(call.method).toBe("GET");
    expect(path(call)).toBe("https://graph.instagram.com/refresh_access_token");
    expect(query(call).get("grant_type")).toBe("ig_refresh_token");
    expect(query(call).get("access_token")).toBe("tok-1");
  });

  it("uses the refreshed token for later calls", async () => {
    const r = recorder((req) =>
      req.url.includes("refresh_access_token") ? json({ access_token: "tok-2", expires_in: 100 }) : json({ id: "x", username: "y" }),
    );
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    await ig.refreshToken();
    await ig.me();

    expect(query(r.calls[1]!).get("access_token")).toBe("tok-2");
  });
});

describe("errors and retries", () => {
  it("maps a Graph error onto a typed error", async () => {
    const r = recorder(() =>
      json(
        {
          error: {
            message: "The image is not accessible",
            type: "OAuthException",
            code: 100,
            error_subcode: 2_207_052,
            fbtrace_id: "Axf-9",
          },
        },
        400,
      ),
    );
    const ig = createInstagram({ ...CFG, fetch: r.fetch });

    const err = (await ig.createImageContainer({ imageUrl: "https://x/a.jpg" }).catch((e: unknown) => e)) as InstagramError;
    expect(err).toBeInstanceOf(InstagramError);
    expect(err.message).toContain("The image is not accessible");
    expect(err.status).toBe(400);
    expect(err.code).toBe(100);
    expect(err.errorSubcode).toBe(2_207_052);
    expect(err.fbtraceId).toBe("Axf-9");
    expect(r.calls).toHaveLength(1);
  });

  it("retries once after a server error, five seconds later", async () => {
    const waits: number[] = [];
    const r = recorder((_req, n) => (n === 0 ? json({ error: { message: "oops", code: 2 } }, 500) : json({ id: "cont-9" })));
    const ig = createInstagram({
      ...CFG,
      fetch: r.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(ig.createImageContainer({ imageUrl: "https://x/a.jpg" })).resolves.toEqual({ id: "cont-9" });
    expect(r.calls).toHaveLength(2);
    expect(waits).toEqual([5000]);
  });

  it("retries once when Graph throttles with code 4 or code 17", async () => {
    for (const code of [4, 17]) {
      const r = recorder((_req, n) => (n === 0 ? json({ error: { message: "throttled", code } }, 400) : json({ id: "ok" })));
      const ig = createInstagram({ ...CFG, fetch: r.fetch, sleep: async () => {} });
      await expect(ig.createImageContainer({ imageUrl: "https://x/a.jpg" })).resolves.toEqual({ id: "ok" });
      expect(r.calls).toHaveLength(2);
    }
  });

  it("retries only once and then throws", async () => {
    const r = recorder(() => json({ error: { message: "still down", code: 2 } }, 503));
    const ig = createInstagram({ ...CFG, fetch: r.fetch, sleep: async () => {} });

    await expect(ig.quota()).rejects.toBeInstanceOf(InstagramError);
    expect(r.calls).toHaveLength(2);
  });

  it("does not retry an authentication failure", async () => {
    const r = recorder(() => json({ error: { message: "Invalid OAuth 2.0 Access Token", code: 190 } }, 401));
    const ig = createInstagram({ ...CFG, fetch: r.fetch, sleep: async () => {} });

    await expect(ig.me()).rejects.toThrow(/Invalid OAuth/);
    expect(r.calls).toHaveLength(1);
  });
});

describe("configuration", () => {
  it("lets the caller pin a different API version", async () => {
    const r = recorder(() => json({ id: "c" }));
    const ig = createInstagram({ ...CFG, fetch: r.fetch, apiBase: "https://graph.instagram.com/v23.0" });

    await ig.createImageContainer({ imageUrl: "https://x/a.jpg" });
    expect(r.calls[0]!.url).toBe("https://graph.instagram.com/v23.0/17841400000/media");
  });
});
