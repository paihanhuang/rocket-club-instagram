import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Fetch } from "../newsroom/ports.js";
import { createFakeImageHost } from "./fake.js";
import { createGitHubPagesHost, ImageHostError } from "./index.js";

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
const image = () => new Response("bytes", { status: 200, headers: { "content-type": "image/jpeg" } });

const dirs: string[] = [];
async function tmpJpeg(name: string): Promise<{ name: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "host-"));
  dirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, TINY_JPEG);
  return { name, path };
}
afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const CFG = {
  owner: "paihanhuang",
  repo: "rocket-club-instagram",
  branch: "gh-pages",
  dir: "media",
  siteBase: "https://paihanhuang.github.io/rocket-club-instagram",
  token: "ghp-test",
};
const CONTENTS = "https://api.github.com/repos/paihanhuang/rocket-club-instagram/contents/media";

describe("publish", () => {
  it("creates a new file with base64 content on the branch and returns its Pages URL", async () => {
    const file = await tmpJpeg("2026-09-26-1.jpg");
    const r = recorder((req) => (req.method === "GET" ? json({ message: "Not Found" }, 404) : json({ content: { sha: "new" } }, 201)));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    const urls = await host.publish([file]);

    expect(urls).toEqual(["https://paihanhuang.github.io/rocket-club-instagram/media/2026-09-26-1.jpg"]);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]).toMatchObject({ method: "GET", url: `${CONTENTS}/2026-09-26-1.jpg?ref=gh-pages` });

    const put = r.calls[1]!;
    expect(put.method).toBe("PUT");
    expect(put.url).toBe(`${CONTENTS}/2026-09-26-1.jpg`);
    expect(put.headers["authorization"]).toBe("Bearer ghp-test");
    expect(put.headers["accept"]).toBe("application/vnd.github+json");
    expect(put.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(String(put.body)) as Record<string, unknown>;
    expect(body["branch"]).toBe("gh-pages");
    expect(body["message"]).toBeTypeOf("string");
    expect(body["sha"]).toBeUndefined();
    expect(Buffer.from(String(body["content"]), "base64")).toEqual(TINY_JPEG);
  });

  it("sends the current sha when the file already exists", async () => {
    const file = await tmpJpeg("cover.jpg");
    const r = recorder((req) => (req.method === "GET" ? json({ sha: "old-sha", name: "cover.jpg" }) : json({}, 200)));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    await host.publish([file]);

    expect(JSON.parse(String(r.calls[1]!.body))["sha"]).toBe("old-sha");
  });

  it("publishes several files in order and returns one URL each", async () => {
    const files = [await tmpJpeg("a.jpg"), await tmpJpeg("b.jpg")];
    const r = recorder((req) => (req.method === "GET" ? json({}, 404) : json({}, 201)));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    await expect(host.publish(files)).resolves.toEqual([
      "https://paihanhuang.github.io/rocket-club-instagram/media/a.jpg",
      "https://paihanhuang.github.io/rocket-club-instagram/media/b.jpg",
    ]);
    expect(r.calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([
      `${CONTENTS}/a.jpg`,
      `${CONTENTS}/b.jpg`,
    ]);
  });

  it("throws a typed error when GitHub refuses the write", async () => {
    const file = await tmpJpeg("a.jpg");
    const r = recorder((req) => (req.method === "GET" ? json({}, 404) : json({ message: "Bad credentials" }, 401)));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    const err = await host.publish([file]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageHostError);
    expect(String(err)).toMatch(/401|Bad credentials/);
  });
});

describe("waitUntilServed", () => {
  const url = "https://paihanhuang.github.io/rocket-club-instagram/media/a.jpg";

  it("polls with a cache-busting query until the URL serves an image", async () => {
    const waits: number[] = [];
    const r = recorder((_req, n) => (n < 2 ? new Response("not found", { status: 404 }) : image()));
    const host = createGitHubPagesHost({
      ...CFG,
      fetch: r.fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(host.waitUntilServed([url])).resolves.toBeUndefined();
    expect(r.calls).toHaveLength(3);
    expect(r.calls[0]!.method).toBe("GET");
    expect(r.calls[0]!.url).toMatch(/^https:\/\/paihanhuang\.github\.io\/rocket-club-instagram\/media\/a\.jpg\?/);
    expect(r.calls[0]!.headers["cache-control"]).toBe("no-cache");
    expect(new Set(r.calls.map((c) => c.url)).size).toBe(3);
    expect(waits).toEqual([10_000, 10_000]);
  });

  it("keeps waiting while the URL serves a non-image content type", async () => {
    const r = recorder((_req, n) =>
      n < 1 ? new Response("bytes", { status: 200, headers: { "content-type": "text/plain" } }) : image(),
    );
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch, sleep: async () => {} });

    await host.waitUntilServed([url]);
    expect(r.calls).toHaveLength(2);
  });

  it("stops asking for URLs that are already served", async () => {
    const other = "https://paihanhuang.github.io/rocket-club-instagram/media/b.jpg";
    const r = recorder((req) => (req.url.includes("/a.jpg") ? image() : new Response(null, { status: 404 })));
    let clock = 0;
    const host = createGitHubPagesHost({
      ...CFG,
      fetch: r.fetch,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    const err = await host.waitUntilServed([url, other], { timeoutMs: 30_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImageHostError);
    expect((err as ImageHostError).missing).toEqual([other]);
    expect(String(err)).toContain("b.jpg");
    expect(r.calls.filter((c) => c.url.includes("/a.jpg"))).toHaveLength(1);
  });

  it("gives up at the deadline", async () => {
    const r = recorder(() => new Response(null, { status: 404 }));
    let clock = 0;
    const host = createGitHubPagesHost({
      ...CFG,
      fetch: r.fetch,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    });

    await expect(host.waitUntilServed([url], { timeoutMs: 60_000 })).rejects.toBeInstanceOf(ImageHostError);
    expect(r.calls.length).toBe(7);
  });
});

describe("remove", () => {
  it("deletes each file with its current sha", async () => {
    const r = recorder((req) => (req.method === "GET" ? json({ sha: "sha-1" }) : json({ commit: {} })));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    await host.remove(["a.jpg"]);

    expect(r.calls[0]).toMatchObject({ method: "GET", url: `${CONTENTS}/a.jpg?ref=gh-pages` });
    const del = r.calls[1]!;
    expect(del.method).toBe("DELETE");
    expect(del.url).toBe(`${CONTENTS}/a.jpg`);
    const body = JSON.parse(String(del.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ sha: "sha-1", branch: "gh-pages" });
    expect(body["message"]).toBeTypeOf("string");
  });

  it("ignores a file that is already gone", async () => {
    const r = recorder(() => json({ message: "Not Found" }, 404));
    const host = createGitHubPagesHost({ ...CFG, fetch: r.fetch });

    await expect(host.remove(["gone.jpg"])).resolves.toBeUndefined();
    expect(r.calls).toHaveLength(1);
  });
});

describe("the fake host", () => {
  it("returns fake URLs and records every call", async () => {
    const host = createFakeImageHost();

    const urls = await host.publish([
      { name: "a.jpg", path: "/tmp/a.jpg" },
      { name: "b.jpg", path: "/tmp/b.jpg" },
    ]);
    expect(urls).toEqual(["https://fake.local/media/a.jpg", "https://fake.local/media/b.jpg"]);

    await host.waitUntilServed(urls);
    await host.remove(["a.jpg"]);

    expect(host.published).toEqual([
      { name: "a.jpg", path: "/tmp/a.jpg" },
      { name: "b.jpg", path: "/tmp/b.jpg" },
    ]);
    expect(host.waited).toEqual([urls]);
    expect(host.removed).toEqual(["a.jpg"]);
    expect(host.calls).toEqual(["publish", "waitUntilServed", "remove"]);
  });
});
