/**
 * Live check of the writer against the real local model.
 *
 *   pnpm exec tsx src/writer/live.ts            both harnesses
 *   pnpm exec tsx src/writer/live.ts qwen       just the qwen code CLI
 *   pnpm exec tsx src/writer/live.ts http       just the OpenAI-compatible server
 *
 * Writes out/live-writer-<harness>.json with the draft and the wall clock.
 * Monday 2026-09-28 is Launches day in the rhythm, so this is a launches
 * assignment with three hand-made items; the third has no public launch time,
 * which is what should pull in the "confirm before posting" flag.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { Assignment, Shortlist } from "../newsroom/types.js";
import {
  createWriter,
  DEFAULT_LOCAL_API_KEY,
  DEFAULT_LOCAL_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  DraftInvalidError,
  type ModelChoice,
} from "./index.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GUIDES_DIR = join(ROOT, "guides");
const OUT_DIR = join(ROOT, "out");
const WALL_TIME_MS = Number(process.env["WRITER_WALL_TIME_MS"] ?? 300_000);

const assignment: Assignment = {
  date: "2026-09-28",
  pillar: "launches",
  angle: "what is flying this week and how to watch it live from the Bay Area",
};

const shortlist: Shortlist = {
  assignment,
  items: [
    {
      id: "ll-2026-09-29-falcon9-starlink-11-24",
      source: "Launch Library",
      title: "Falcon 9 · Starlink Group 11-24",
      url: "https://thespacedevs.example/launch/falcon9-starlink-11-24",
      summary:
        "A Falcon 9 is scheduled to carry 28 Starlink v2 Mini satellites to low Earth orbit from Vandenberg Space Force Base. The booster, on its fourteenth flight, will land on the droneship Of Course I Still Love You in the Pacific. The window opens at 6:10pm PT and runs for 59 minutes; the webcast starts about five minutes before liftoff.",
      publishedAt: "2026-09-26T09:00:00-07:00",
      startsAt: "2026-09-29T18:10:00-07:00",
      location: { name: "Vandenberg Space Force Base, SLC-4E", lat: 34.632, lon: -120.611 },
      fetchedAt: "2026-09-27T19:00:00-07:00",
    },
    {
      id: "ll-2026-09-30-electron-strix",
      source: "Launch Library",
      title: "Electron · Owl For One, One For Owl (Synspective StriX-9)",
      url: "https://thespacedevs.example/launch/electron-strix-9",
      summary:
        "Rocket Lab's Electron will loft a single Synspective StriX radar-imaging satellite from Launch Complex 1 in Mahia, New Zealand. Synspective builds small synthetic aperture radar satellites that can see through cloud and at night. Rocket Lab streams the launch on its own channel.",
      publishedAt: "2026-09-25T14:30:00-07:00",
      startsAt: "2026-09-30T22:15:00+13:00",
      location: { name: "Rocket Lab Launch Complex 1, Mahia, New Zealand", lat: -39.262, lon: 177.865 },
      fetchedAt: "2026-09-27T19:00:00-07:00",
    },
    {
      id: "ll-2026-10-vulcan-ussf-87",
      source: "Launch Library",
      title: "Vulcan Centaur · USSF-87",
      url: "https://thespacedevs.example/launch/vulcan-ussf-87",
      summary:
        "United Launch Alliance's Vulcan Centaur is expected to fly the USSF-87 national security mission from Cape Canaveral in early October, carrying two GSSAP surveillance satellites to near-geosynchronous orbit. No public launch time has been released yet and the date has slipped twice already.",
      publishedAt: "2026-09-24T11:00:00-07:00",
      location: { name: "Cape Canaveral Space Force Station, SLC-41", lat: 28.583, lon: -80.583 },
      fetchedAt: "2026-09-27T19:00:00-07:00",
    },
  ],
  notes: [
    "Falcon 9 ranked first: visible from the Bay Area at dusk, confirmed window.",
    "Vulcan has no confirmed time; keep it as background, not the hook.",
  ],
};

const httpChoice: ModelChoice = {
  kind: "http",
  baseUrl: process.env["LOCAL_LLM_BASE_URL"] ?? DEFAULT_LOCAL_BASE_URL,
  apiKey: process.env["LOCAL_LLM_API_KEY"] ?? DEFAULT_LOCAL_API_KEY,
  model: process.env["LOCAL_LLM_MODEL"] ?? DEFAULT_LOCAL_MODEL,
};

const qwenChoice: ModelChoice = { kind: "qwen" };

function describeChoice(choice: ModelChoice): Record<string, unknown> {
  if (choice.kind === "http") return { kind: "http", baseUrl: choice.baseUrl, model: choice.model };
  if (choice.kind === "qwen") return { kind: "qwen", bin: choice.bin ?? "qwen" };
  return { kind: choice.kind };
}

async function runOne(name: string, choice: ModelChoice): Promise<boolean> {
  const writer = createWriter({ model: choice, guidesDir: GUIDES_DIR, wallTimeMs: WALL_TIME_MS });
  const startedAt = new Date().toISOString();
  const started = performance.now();

  process.stdout.write(`\n── ${name}: asking the model (wall time ${WALL_TIME_MS}ms) …\n`);

  try {
    const text = await writer.writeDraft(assignment, shortlist);
    const latencyMs = Math.round(performance.now() - started);
    await save(name, { ok: true, harness: describeChoice(choice), startedAt, latencyMs, assignment, shortlist, text });

    process.stdout.write(`   ok in ${(latencyMs / 1000).toFixed(1)}s\n`);
    process.stdout.write(`   headline : ${text.headline}\n`);
    process.stdout.write(`   slides   : ${text.slides.length}\n`);
    process.stdout.write(`   hashtags : ${text.hashtags.join(" ")}\n`);
    process.stdout.write(`   flags    : ${text.flags.join(" | ") || "(none)"}\n`);
    process.stdout.write(`   caption  :\n${text.caption.replace(/^/gm, "     ")}\n`);
    return true;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const failure = error as Error;
    await save(name, {
      ok: false,
      harness: describeChoice(choice),
      startedAt,
      latencyMs,
      error: {
        name: failure.name,
        message: failure.message,
        ...(error instanceof DraftInvalidError ? { attempts: error.attempts } : {}),
      },
    });
    process.stderr.write(`   failed after ${(latencyMs / 1000).toFixed(1)}s: ${failure.name}: ${failure.message}\n`);
    return false;
  }
}

async function save(name: string, body: Record<string, unknown>): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `live-writer-${name}.json`);
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  process.stdout.write(`   saved ${path}\n`);
}

const only = process.argv[2];
const runs: [string, ModelChoice][] = [
  ["qwen", qwenChoice],
  ["http", httpChoice],
].filter(([name]) => !only || only === name) as [string, ModelChoice][];

let allOk = true;
for (const [name, choice] of runs) {
  // Sequential on purpose: one local model, one request at a time.
  allOk = (await runOne(name, choice)) && allOk;
}
process.exit(allOk ? 0 : 1);
