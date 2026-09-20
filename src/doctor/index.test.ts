import { describe, expect, it } from "vitest";
import type { InstagramPort } from "../newsroom/ports.js";
import { doctor, formatChecks, type Check, type DoctorDeps, type Env } from "./index.js";

const GOOD_ENV: Env = {
  IG_USER_ID: "1784",
  IG_ACCESS_TOKEN: "token",
  DISCORD_BOT_TOKEN: "bot-token",
  DISCORD_APPROVAL_CHANNEL_ID: "42",
  META_APP_ID: "app",
  META_APP_SECRET: "secret",
  LOCAL_LLM_BASE_URL: "http://127.0.0.1:18085/v1",
  LOCAL_LLM_MODEL: "mtplx-qwen38-27b-optimized-quality",
};

const fakeInstagram = (overrides: Partial<InstagramPort> = {}): InstagramPort =>
  ({
    async me() {
      return { id: "1784", username: "lahsrocketry" };
    },
    async quota() {
      return { used: 2, total: 50 };
    },
    ...overrides,
  }) as InstagramPort;

function fakeFetch(routes: Record<string, () => Response>): DoctorDeps["fetch"] {
  return async (input) => {
    const url = String(input);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route) throw new Error(`fetch failed: nothing listening at ${url}`);
    return route[1]();
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    fetch: fakeFetch({
      "http://127.0.0.1:18085/v1/models": () =>
        json({ data: [{ id: "mtplx-qwen38-27b-optimized-quality" }] }),
      "https://discord.com/api/v10/channels/42": () => json({ name: "approvals" }),
      "https://lahs.github.io/newsroom/": () => new Response("<html></html>", { status: 200 }),
    }),
    async run() {
      return { code: 0, stdout: "qwen 0.9.3\n", stderr: "" };
    },
    instagram: fakeInstagram(),
    dirs: { state: "/repo/state", out: "/repo/out", cache: "/repo/cache", photos: "/repo/photos" },
    browserCacheDir: "/home/Library/Caches/ms-playwright",
    pagesUrl: "https://lahs.github.io/newsroom/",
    fs: {
      async ensureDir() {
        return "exists";
      },
      async listDir() {
        return ["chromium-1234", "ffmpeg-1011"];
      },
    },
    ...overrides,
  };
}

const byName = (checks: Check[], name: string): Check => {
  const found = checks.find((c) => c.name === name);
  if (!found) throw new Error(`no check named ${name}`);
  return found;
};

describe("doctor", () => {
  it("passes every check when the Mac is set up", async () => {
    const checks = await doctor(GOOD_ENV, deps());
    expect(checks.map((c) => c.name)).toEqual([
      ".env",
      "model server",
      "qwen cli",
      "instagram account",
      "instagram quota",
      "discord channel",
      "pages site",
      "chromium",
      "directories",
    ]);
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(byName(checks, "instagram account").detail).toBe("@lahsrocketry (1784)");
    expect(byName(checks, "instagram quota").detail).toContain("2 of 50");
    expect(byName(checks, "discord channel").detail).toContain("#approvals");
    expect(byName(checks, "chromium").detail).toBe("chromium-1234");
  });

  it("names the missing keys and still runs the rest", async () => {
    const { IG_ACCESS_TOKEN: _dropped, ...partial } = GOOD_ENV;
    const checks = await doctor(partial, deps());
    expect(byName(checks, ".env")).toMatchObject({ ok: false });
    expect(byName(checks, ".env").detail).toContain("IG_ACCESS_TOKEN");
    expect(byName(checks, "model server").ok).toBe(true);
  });

  it("treats the Meta app keys as optional but says they are missing", async () => {
    const { META_APP_ID: _a, META_APP_SECRET: _b, ...partial } = GOOD_ENV;
    const check = byName(await doctor(partial, deps()), ".env");
    expect(check.ok).toBe(true);
    expect(check.detail).toContain("META_APP_ID");
  });

  it("fails when the model server is not running", async () => {
    const checks = await doctor(GOOD_ENV, deps({ fetch: fakeFetch({}) }));
    expect(byName(checks, "model server").ok).toBe(false);
    expect(byName(checks, "model server").detail).toContain("nothing listening");
  });

  it("fails when the server is up but the model is not loaded", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        fetch: fakeFetch({
          "http://127.0.0.1:18085/v1/models": () => json({ data: [{ id: "some-other-model" }] }),
        }),
      }),
    );
    const check = byName(checks, "model server");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("is not loaded");
    expect(check.detail).toContain("some-other-model");
  });

  it("fails when the qwen cli is not on PATH", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        async run() {
          return { code: 127, stdout: "", stderr: "command not found: qwen" };
        },
      }),
    );
    expect(byName(checks, "qwen cli")).toMatchObject({ ok: false });
    expect(byName(checks, "qwen cli").detail).toContain("command not found");
  });

  it("reports an Instagram token that no longer works", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        instagram: fakeInstagram({
          async me() {
            throw new Error("Meta returned 190: access token expired");
          },
        }),
      }),
    );
    expect(byName(checks, "instagram account")).toMatchObject({ ok: false });
    expect(byName(checks, "instagram account").detail).toContain("access token expired");
    expect(byName(checks, "instagram quota").ok).toBe(true);
  });

  it("says so when there are no Instagram credentials at all", async () => {
    const checks = await doctor(GOOD_ENV, deps({ instagram: undefined }));
    expect(byName(checks, "instagram account").detail).toContain("no Instagram credentials");
  });

  it("explains a Discord channel the bot cannot see", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        fetch: fakeFetch({
          "http://127.0.0.1:18085/v1/models": () => json({ data: [{ id: GOOD_ENV.LOCAL_LLM_MODEL }] }),
          "https://discord.com/api/v10/channels/42": () => json({ message: "Missing Access" }, 403),
          "https://lahs.github.io/newsroom/": () => new Response("", { status: 200 }),
        }),
      }),
    );
    const check = byName(checks, "discord channel");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("403");
    expect(check.detail).toContain("can it see the channel");
  });

  it("fails the pages check on anything but a 200", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        fetch: fakeFetch({
          "http://127.0.0.1:18085/v1/models": () => json({ data: [{ id: GOOD_ENV.LOCAL_LLM_MODEL }] }),
          "https://discord.com/api/v10/channels/42": () => json({ name: "approvals" }),
          "https://lahs.github.io/newsroom/": () => new Response("no", { status: 404 }),
        }),
      }),
    );
    expect(byName(checks, "pages site")).toMatchObject({ ok: false });
    expect(byName(checks, "pages site").detail).toContain("404");
  });

  it("tells you how to install Chromium when it is missing", async () => {
    const checks = await doctor(
      GOOD_ENV,
      deps({
        fs: {
          async ensureDir() {
            return "exists";
          },
          async listDir() {
            return ["ffmpeg-1011"];
          },
        },
      }),
    );
    expect(byName(checks, "chromium")).toMatchObject({ ok: false });
    expect(byName(checks, "chromium").detail).toContain("playwright install chromium");
  });

  it("creates the runtime directories that are missing", async () => {
    const made: string[] = [];
    const checks = await doctor(
      GOOD_ENV,
      deps({
        fs: {
          async ensureDir(path) {
            made.push(path);
            return path.endsWith("photos") ? "created" : "exists";
          },
          async listDir() {
            return ["chromium-1234"];
          },
        },
      }),
    );
    expect(made).toEqual(["/repo/state", "/repo/out", "/repo/cache", "/repo/photos"]);
    expect(byName(checks, "directories")).toMatchObject({ ok: true });
    expect(byName(checks, "directories").detail).toBe(
      "state exists, out exists, cache exists, photos created",
    );
  });

  it("never throws, whatever the environment looks like", async () => {
    const checks = await doctor(
      {},
      deps({
        fetch: async () => {
          throw new Error("offline");
        },
        async run() {
          throw new Error("no shell");
        },
        instagram: undefined,
        pagesUrl: undefined,
        fs: {
          async ensureDir() {
            throw new Error("read-only disk");
          },
          async listDir() {
            throw new Error("no such directory");
          },
        },
      }),
    );
    expect(checks).toHaveLength(9);
    expect(checks.every((c) => !c.ok)).toBe(true);
  });
});

describe("formatChecks", () => {
  it("prints a tick or a cross per line and counts the failures", () => {
    const table = formatChecks([
      { name: ".env", ok: true, detail: "all keys present" },
      { name: "chromium", ok: false, detail: "not installed" },
    ]);
    expect(table).toContain("✓  .env      all keys present");
    expect(table).toContain("✗  chromium  not installed");
    expect(table).toContain("1 of 2 checks failed.");
    expect(formatChecks([{ name: "x", ok: true, detail: "y" }])).toContain("All checks passed.");
  });
});
