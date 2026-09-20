#!/usr/bin/env node
/**
 * `pnpm tool <command>` — the only place the newsroom's modules are wired to
 * the real world. Everything below is composition: reading `.env`, building
 * the adapters, and handing them to the runner, the publisher or the doctor.
 * No behaviour lives here.
 *
 *   pnpm tool doctor                       every credential and dependency
 *   pnpm tool daily [--date D] [--dry-run] draft one day's post
 *   pnpm tool publish                      one publisher pass
 *   pnpm tool gate                         21 dry runs, the readiness test
 *   pnpm tool spike --image <path>         one real post, to prove the path
 *   pnpm tool token-refresh                renew the long-lived token
 *
 * The adapters are imported where they are used, so `doctor` still runs when
 * a module it does not need is broken or not written yet.
 */
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DiscordPort, ImageHostPort, InstagramPort } from "./newsroom/ports.js";
import { readAssignment } from "./plan/index.js";
import { addDays, localDate } from "./plan/time.js";
import { doctor, formatChecks, nodeFs, runCommand } from "./doctor/index.js";
import { readTokenFile, runPublisher, writeTokenFile } from "./publisher/index.js";
import {
  ensureModelServer,
  nextAssignmentDate,
  runDaily,
  spawnDetached,
  type DailyDeps,
} from "./runner/index.js";
import { createDraftStore } from "./store/index.js";

const ROOT = process.cwd();
const dirs = {
  state: join(ROOT, "state"),
  drafts: join(ROOT, "state", "drafts"),
  out: join(ROOT, "out"),
  cache: join(ROOT, "cache"),
  photos: join(ROOT, "photos"),
  plan: join(ROOT, "plan"),
  guides: join(ROOT, "guides"),
};
const TOKEN_FILE = join(dirs.state, "instagram-token.json");
// Fence rule 8: every post carries a source line, even the spike's.
const SPIKE_CAPTION = "Test post from the newsroom spike. Will be deleted.\n\nSource: LAHS Rocket Club.";

const env = process.env;
const say = (line = ""): void => console.log(line);

function required(key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set — see docs/setup/accounts-and-keys.md`);
  return value;
}

/** The long-lived token the publisher refreshed, falling back to `.env`. */
async function currentToken(): Promise<string> {
  const stored = await readTokenFile(TOKEN_FILE);
  if (stored?.token) return stored.token;
  const token = required("IG_ACCESS_TOKEN");
  // Start the 60-day clock the first time the token is used, so the day-50
  // refresh has a date to count from. `pnpm tool token-refresh` makes it exact.
  const now = new Date();
  await mkdir(dirs.state, { recursive: true });
  await writeTokenFile(TOKEN_FILE, {
    token,
    obtainedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 24 * 3_600_000).toISOString(),
  });
  say(`note: token clock started today; run "pnpm tool token-refresh" once to make it exact.`);
  return token;
}

const pagesSiteBase = (): string =>
  (env["PAGES_SITE_BASE"] ?? "").replace(/\/$/, "") ||
  `https://${required("PAGES_OWNER")}.github.io/${required("PAGES_REPO")}`;

/** The site index the doctor asks for, when the Pages host is configured. */
function pagesIndexUrl(): string | undefined {
  if (env["PAGES_URL"]) return env["PAGES_URL"];
  const base = (env["PAGES_SITE_BASE"] ?? "").replace(/\/$/, "");
  if (base) return `${base}/`;
  const owner = env["PAGES_OWNER"];
  const repo = env["PAGES_REPO"];
  return owner && repo ? `https://${owner}.github.io/${repo}/` : undefined;
}

async function makeInstagram(): Promise<InstagramPort> {
  const { createInstagram } = await import("./instagram/index.js");
  return createInstagram({
    userId: required("IG_USER_ID"),
    token: await currentToken(),
    fetch,
  });
}

async function makeDiscord(opts: { allowConsole?: boolean } = {}): Promise<DiscordPort> {
  if (!env["DISCORD_BOT_TOKEN"] && opts.allowConsole) {
    const { createConsoleDiscord } = await import("./discord/console.js");
    say("note: DISCORD_BOT_TOKEN is not set; cards go to out/cards instead of Discord.");
    return createConsoleDiscord({ outDir: join(dirs.out, "cards") });
  }
  const { createDiscord } = await import("./discord/index.js");
  const approvers = (env["DISCORD_APPROVERS"] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (approvers.length === 0) {
    say("note: DISCORD_APPROVERS is empty, so no reaction will count as a verdict.");
  }
  return createDiscord({
    token: required("DISCORD_BOT_TOKEN"),
    channelId: required("DISCORD_APPROVAL_CHANNEL_ID"),
    approvers,
    fetch,
  });
}

async function makeImageHost(): Promise<ImageHostPort> {
  const { createGitHubPagesHost } = await import("./imagehost/index.js");
  const token = env["GITHUB_TOKEN"];
  return createGitHubPagesHost({
    owner: required("PAGES_OWNER"),
    repo: required("PAGES_REPO"),
    branch: env["PAGES_BRANCH"] ?? "gh-pages",
    dir: env["PAGES_DIR"] ?? "media",
    siteBase: pagesSiteBase(),
    fetch,
    ...(token ? { token } : {}),
  });
}

type DailyOptions = { storeDir?: string; outDir?: string; net?: typeof fetch };

async function makeDailyDeps(options: DailyOptions = {}): Promise<DailyDeps> {
  const [{ fetchItems }, { shortlist, LOS_ALTOS }, { findLicensedPhoto }, { createWriter }, { renderSlides }, { createPhotoStore }] =
    await Promise.all([
      import("./sources/index.js"),
      import("./shortlist/index.js"),
      import("./license/index.js"),
      import("./writer/index.js"),
      import("./render/index.js"),
      import("./photos/index.js"),
    ]);
  // Fence rule 2: club photos come only from the consented folder.
  const clubPhotos = createPhotoStore(join(dirs.photos, "consented"));

  const net = options.net ?? fetch;
  const http = {
    kind: "http" as const,
    baseUrl: env["LOCAL_LLM_BASE_URL"] ?? "http://127.0.0.1:18085/v1",
    apiKey: env["LOCAL_LLM_API_KEY"] ?? "local-no-auth",
    model: env["LOCAL_LLM_MODEL"] ?? "mtplx-qwen38-27b-optimized-quality",
  };
  const choice = env["WRITER_MODEL"] ?? "qwen";
  const primary = createWriter({
    model: choice === "http" ? http : choice === "auto" ? "auto" : { kind: "qwen" },
    guidesDir: dirs.guides,
    wallTimeMs: Number(env["WRITER_WALL_TIME_S"] ?? 600) * 1000,
  });
  // qwen code is the chosen harness (ADR-0007); if the CLI itself is missing or
  // times out, the direct HTTP adapter to the same model is the fallback.
  const fallback = choice === "qwen" ? createWriter({ model: http, guidesDir: dirs.guides }) : undefined;
  const { ModelTimeoutError, ModelUnavailableError } = await import("./writer/index.js");
  const writeDraft: DailyDeps["writer"]["writeDraft"] = async (assignment, list, photo) => {
    try {
      return await primary.writeDraft(assignment, list, photo);
    } catch (error) {
      if (fallback && (error instanceof ModelUnavailableError || error instanceof ModelTimeoutError)) {
        say(`note: qwen harness failed (${error.message}); retrying over HTTP.`);
        return fallback.writeDraft(assignment, list, photo);
      }
      throw error;
    }
  };

  return {
    now: () => new Date(),
    ensureModelServer: startModelServer,
    readAssignment,
    fetchItems: (pillar, opts) => fetchItems(pillar, { ...opts, fetch: net }),
    shortlist: (items, assignment, opts) => shortlist(items, assignment, opts),
    findLicensedPhoto: (list, opts) => findLicensedPhoto(list, { ...opts, fetch: net, clubPhotos }),
    writer: { writeDraft },
    renderSlides: (text, pillar, photo, outDir) => renderSlides(text, pillar, photo, outDir),
    store: createDraftStore(options.storeDir ?? dirs.drafts),
    discord: await makeDiscord({ allowConsole: true }),
    home: LOS_ALTOS,
    dirs: {
      cache: dirs.cache,
      photos: dirs.photos,
      out: options.outDir ?? dirs.out,
      plan: dirs.plan,
    },
  };
}

async function startModelServer(): Promise<void> {
  const baseUrl = env["LOCAL_LLM_BASE_URL"] ?? "http://127.0.0.1:18085/v1";
  const port = new URL(baseUrl).port || "18085";
  await ensureModelServer({
    baseUrl,
    exec: spawnDetached,
    // The MTPLX cache holds two models; name the 3.8 quality one explicitly so a
    // cold start never comes up on the 3.6 speed model (ADR-0004: Qwen 3.8 27B).
    startCommand: [
      "mtplx", "quickstart", "--port", port, "--yes",
      "--model", env["LOCAL_LLM_MTPLX_MODEL"] ?? "Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality",
      "--model-id", env["LOCAL_LLM_MODEL"] ?? "mtplx-qwen38-27b-optimized-quality",
    ],
  });
}

// --- commands --------------------------------------------------------------

async function commandDoctor(): Promise<number> {
  let instagram: InstagramPort | undefined;
  try {
    instagram = await makeInstagram();
  } catch {
    instagram = undefined;
  }
  const checks = await doctor(env, {
    fetch,
    run: runCommand,
    instagram,
    dirs: { state: dirs.state, out: dirs.out, cache: dirs.cache, photos: dirs.photos },
    browserCacheDir: join(env["HOME"] ?? "", "Library", "Caches", "ms-playwright"),
    pagesUrl: pagesIndexUrl(),
    fs: nodeFs,
  });
  say(formatChecks(checks));
  return checks.every((c) => c.ok) ? 0 : 1;
}

async function commandDaily(args: string[]): Promise<number> {
  const date = flag(args, "--date") ?? nextAssignmentDate(new Date());
  const dryRun = args.includes("--dry-run");
  say(`Drafting ${date}${dryRun ? " (dry run)" : ""}…`);
  const result = await runDaily({ date, deps: await makeDailyDeps(), dryRun });
  if (!result.ok) {
    say(`✗ failed at ${result.step}: ${result.error}`);
    return 1;
  }
  say(result.skipped ? `· ${date} already has draft ${result.draftId}` : `✓ ${result.draftId}`);
  return 0;
}

async function commandPublish(): Promise<number> {
  const report = await runPublisher({
    now: () => new Date(),
    store: createDraftStore(dirs.drafts),
    discord: await makeDiscord(),
    imagehost: await makeImageHost(),
    instagram: await makeInstagram(),
    tokenFile: TOKEN_FILE,
  });
  say(
    `${report.at} · window ${report.windowOpen ? "open" : "closed"} · considered ${report.considered}`,
  );
  for (const post of report.posts) say(`✓ ${post.draftId} → ${post.permalink ?? post.mediaId}`);
  for (const skip of report.skipped) say(`· ${skip.draftId}: ${skip.reason}`);
  for (const bad of report.failed) say(`✗ ${bad.draftId} at ${bad.step}: ${bad.message}`);
  if (report.tokenRefreshed) say("· Instagram token refreshed");
  return report.failed.length === 0 ? 0 : 1;
}

/**
 * The gate: every weekday assignment three times, all dry runs, nothing
 * published. Twenty-one consecutive days covers each pillar exactly three
 * times. `GATE_FIXTURES=1` replays the recorded sources so only the model and
 * the renderer are under test.
 */
async function commandGate(): Promise<number> {
  const storeDir = join(dirs.state, "gate");
  const outDir = join(dirs.out, "gate");
  await rm(storeDir, { recursive: true, force: true });
  await mkdir(storeDir, { recursive: true });

  const net = env["GATE_FIXTURES"] === "1" ? await fixtureFetch() : undefined;
  say(net ? "Sources: recorded fixtures." : "Sources: live network.");

  const deps = await makeDailyDeps({ storeDir, outDir, ...(net ? { net } : {}) });
  const today = localDate(new Date());
  const startedAll = Date.now();
  let passed = 0;

  for (let i = 0; i < 21; i += 1) {
    const date = addDays(today, i + 1);
    const assignment = await readAssignment(date, dirs.plan);
    const started = Date.now();
    const result = await runDaily({ date, deps, dryRun: true });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.ok) {
      passed += 1;
      say(`✓ ${i + 1}/21 ${date} ${assignment.pillar.padEnd(13)} ${seconds}s ${result.draftId}`);
    } else {
      say(`✗ ${i + 1}/21 ${date} ${assignment.pillar.padEnd(13)} ${seconds}s ${result.step}: ${result.error}`);
    }
  }

  say("");
  say(`${passed} of 21 runs passed in ${((Date.now() - startedAll) / 1000 / 60).toFixed(1)} minutes.`);
  return passed === 21 ? 0 : 1;
}

/** The recorded source responses, with a 404 for anything else. */
async function fixtureFetch(): Promise<typeof fetch> {
  const { fakeFetch } = await import("../tests/fixtures/fake-fetch.js");
  return fakeFetch([
    { match: "ll.thespacedevs.com", fixture: "launchlibrary-upcoming.json", contentType: "application/json" },
    { match: "nasa.gov/news-release", fixture: "rss-nasa.xml", contentType: "application/rss+xml" },
    { match: "spacenews.com/feed", fixture: "rss-spacenews.xml", contentType: "application/rss+xml" },
    { match: "nasaspaceflight.com/feed", fixture: "rss-nasaspaceflight.xml", contentType: "application/rss+xml" },
    { match: "", status: 404, body: "not recorded" },
  ]);
}

/**
 * The day-zero spike: one real single-image post, end to end, through the real
 * image host and the real Instagram. Delete it from the app afterwards.
 */
async function commandSpike(args: string[]): Promise<number> {
  const image = flag(args, "--image");
  if (!image) throw new Error("spike needs --image <path to a 1080x1350 jpeg>");
  // Fence rule 1: a human approves every post. The spike is approved by the
  // person typing --yes, and only they can delete it afterwards.
  if (!args.includes("--yes")) {
    throw new Error("spike publishes a real post to the account; re-run with --yes to confirm you will delete it afterwards");
  }
  const path = resolve(ROOT, image);
  if (!existsSync(path)) throw new Error(`no such image: ${path}`);

  const host = await makeImageHost();
  const instagram = await makeInstagram();
  const name = `spike-${Date.now()}.jpg`;

  say(`1. publishing ${name} to the image host…`);
  const urls = await host.publish([{ name, path }]);
  const url = urls[0];
  if (!url) throw new Error("the image host returned no url");
  say(`   ${url}`);

  say("2. waiting until it is served…");
  await host.waitUntilServed(urls);

  say("3. creating the container…");
  const container = await instagram.createImageContainer({ imageUrl: url, caption: SPIKE_CAPTION });
  say(`   ${container.id}`);

  say("4. waiting for FINISHED…");
  for (let i = 0; i < 60; i += 1) {
    const status = await instagram.containerStatus(container.id);
    if (status === "FINISHED" || status === "PUBLISHED") break;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`container came back ${status}`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  say("5. publishing…");
  const published = await instagram.publish(container.id);
  say(`   media ${published.mediaId}`);

  say("6. removing the image from the Pages branch…");
  await host.remove([name]);

  say("");
  say(`✓ ${published.permalink ?? published.mediaId}`);
  return 0;
}

async function commandTokenRefresh(): Promise<number> {
  const instagram = await makeInstagram();
  const { token, expiresAt } = await instagram.refreshToken();
  await writeTokenFile(TOKEN_FILE, { token, obtainedAt: new Date().toISOString(), expiresAt });
  say(`✓ token refreshed, expires ${expiresAt}`);
  say(`  written to ${TOKEN_FILE}; .env does not need changing.`);
  return 0;
}

// --- entry point -----------------------------------------------------------

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

const USAGE = [
  "pnpm tool <command>",
  "",
  "  doctor                        check every credential and dependency",
  "  daily [--date YYYY-MM-DD] [--dry-run]",
  "  publish                       one publisher pass",
  "  gate                          21 dry runs (GATE_FIXTURES=1 to replay sources)",
  "  spike --image <path> --yes    one real post, end to end (you delete it afterwards)",
  "  token-refresh                 renew the long-lived Instagram token",
].join("\n");

async function main(): Promise<number> {
  if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

  const [command = "", ...args] = process.argv.slice(2);
  switch (command) {
    case "doctor":
      return commandDoctor();
    case "daily":
      return commandDaily(args);
    case "publish":
      return commandPublish();
    case "gate":
      return commandGate();
    case "spike":
      return commandSpike(args);
    case "token-refresh":
      return commandTokenRefresh();
    default:
      say(USAGE);
      return command === "" || command === "help" || command === "--help" ? 0 : 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    say(`✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
