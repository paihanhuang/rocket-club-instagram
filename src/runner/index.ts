/**
 * The daily runner: one assignment in, one draft waiting for a verdict out.
 *
 * It is deliberately thin. It owns the order of the steps, the decision to
 * skip a day that already has a draft, and the failure report — nothing else.
 * Every step is a module injected as a dependency, so this file never imports
 * a source, a model or a browser and the whole sequence is testable with
 * fakes.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Clock, DiscordPort, DraftStore, Fetch } from "../newsroom/ports.js";
import type {
  Assignment,
  Draft,
  DraftText,
  Item,
  LicensedPhoto,
  Pillar,
  Shortlist,
  Slide,
} from "../newsroom/types.js";
import { localDate, localHour } from "../plan/time.js";
import { newDraft } from "../store/index.js";

export type Home = { lat: number; lon: number };

/**
 * The steps, each narrowed to what the runner knows. The composition root
 * binds the wider signatures in `docs/design/modules.md` (fetch, guides,
 * generate, browser) before handing them over.
 */
export type ReadAssignmentStep = (date: string, planDir: string) => Promise<Assignment>;
export type FetchItemsStep = (
  pillar: Pillar,
  opts: { now: Date; cacheDir: string },
) => Promise<Item[]>;
export type ShortlistStep = (
  items: Item[],
  assignment: Assignment,
  opts: { now: Date; home: Home },
) => Shortlist | Promise<Shortlist>;
export type FindLicensedPhotoStep = (
  shortlist: Shortlist,
  opts: { photoDir: string },
) => Promise<LicensedPhoto | undefined>;
export type WriteDraftStep = (
  assignment: Assignment,
  shortlist: Shortlist,
  photo: LicensedPhoto | undefined,
) => Promise<DraftText>;
export type RenderSlidesStep = (
  text: DraftText,
  pillar: Pillar,
  photo: LicensedPhoto | undefined,
  outDir: string,
) => Promise<Slide[]>;

export type DailyDeps = {
  now: Clock;
  readAssignment: ReadAssignmentStep;
  fetchItems: FetchItemsStep;
  shortlist: ShortlistStep;
  findLicensedPhoto: FindLicensedPhotoStep;
  writer: { writeDraft: WriteDraftStep };
  renderSlides: RenderSlidesStep;
  store: DraftStore;
  discord: DiscordPort;
  home: Home;
  dirs: { cache: string; photos: string; out: string; plan: string };
};

export type RunStep =
  | "load"
  | "readAssignment"
  | "fetchItems"
  | "shortlist"
  | "findLicensedPhoto"
  | "writeDraft"
  | "renderSlides"
  | "save"
  | "postDraft";

export type RunResult =
  | { ok: true; draftId: string; skipped?: "exists"; dryRun?: true }
  | { ok: false; step: RunStep; error: string; draftId?: string };

export type RunDailyInput = {
  date: string;
  deps: DailyDeps;
  /** Posts the card for real, then expires the draft so it can never publish. */
  dryRun?: boolean;
};

/**
 * The day the evening run is drafting for. The generation job fires at 20:30
 * for tomorrow; when the Mac was asleep, launchd runs the missed job on wake,
 * and by then "tomorrow" has become "today" — which is the same day either
 * way.
 */
export const EVENING_HOUR = 18;
export function nextAssignmentDate(now: Date): string {
  const today = localDate(now);
  if (localHour(now) < EVENING_HOUR) return today;
  const at = new Date(`${today}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A draft already stands for that day unless the last attempt failed. */
function existingFor(drafts: Draft[], date: string): Draft | undefined {
  return drafts.find((d) => d.assignment.date === date && d.status !== "failed");
}

export async function runDaily({ date, deps, dryRun = false }: RunDailyInput): Promise<RunResult> {
  const { store, discord } = deps;
  let step: RunStep = "load";
  let draft: Draft | undefined;
  let saved = false;

  try {
    const existing = existingFor(await store.list(), date);
    if (existing) return { ok: true, draftId: existing.id, skipped: "exists" };

    const now = deps.now();

    step = "readAssignment";
    const assignment = await deps.readAssignment(date, deps.dirs.plan);

    step = "fetchItems";
    const items = await deps.fetchItems(assignment.pillar, { now, cacheDir: deps.dirs.cache });

    step = "shortlist";
    const shortlist = await deps.shortlist(items, assignment, { now, home: deps.home });

    step = "findLicensedPhoto";
    const photo = await deps.findLicensedPhoto(shortlist, { photoDir: deps.dirs.photos });

    step = "writeDraft";
    const text = await deps.writer.writeDraft(assignment, shortlist, photo);

    step = "renderSlides";
    const slides = await deps.renderSlides(text, assignment.pillar, photo, join(deps.dirs.out, date));

    step = "save";
    draft = await newDraft({ assignment, text, slides, photo, now, items: shortlist.items });
    await store.save(draft);
    saved = true;

    step = "postDraft";
    const { messageId } = await discord.postDraft(draft, slides);
    draft = { ...draft, discordMessageId: messageId };
    await store.save(draft);

    if (dryRun) {
      await store.transition(draft.id, "pending", "expired");
      return { ok: true, draftId: draft.id, dryRun: true };
    }
    return { ok: true, draftId: draft.id };
  } catch (error) {
    const message = messageOf(error);
    await recordFailure({ store, discord, date, step, message, draft, saved });
    return draft ? { ok: false, step, error: message, draftId: draft.id } : { ok: false, step, error: message };
  }
}

async function recordFailure(args: {
  store: DraftStore;
  discord: DiscordPort;
  date: string;
  step: RunStep;
  message: string;
  draft: Draft | undefined;
  saved: boolean;
}): Promise<void> {
  const { store, discord, date, step, message, draft, saved } = args;
  if (draft) {
    try {
      if (saved) await store.transition(draft.id, draft.status, "failed", { error: message });
      else await store.save({ ...draft, status: "failed", error: message });
    } catch {
      // The failure report matters more than the record of it.
    }
  }
  try {
    await discord.notify(
      `⚠️ Daily run for ${date} failed at **${step}**: ${message}${draft ? `\nDraft ${draft.id} is marked failed.` : ""}`,
    );
  } catch {
    // Discord is not a reason to throw out of the nightly job.
  }
}

// --- the local model server ------------------------------------------------

export type ExecPort = (argv: readonly string[]) => void;

/** Starts a command detached, so it outlives this process. */
export const spawnDetached: ExecPort = (argv) => {
  const [command, ...args] = argv;
  if (!command) throw new Error("spawnDetached: empty command");
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
};

export type EnsureModelServerConfig = {
  baseUrl: string;
  exec: ExecPort;
  startCommand?: readonly string[];
  timeoutMs?: number;
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: Clock;
};

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const MODEL_POLL_MS = 5_000;

/**
 * The write step needs the local model. Ask the server; if it does not answer,
 * start it detached and wait for it. Throws only when it never comes up.
 */
export async function ensureModelServer(config: EnsureModelServerConfig): Promise<void> {
  const {
    baseUrl,
    exec,
    startCommand = ["mtplx", "quickstart", "--port", "18085"],
    timeoutMs = 240_000,
    fetch: doFetch = fetch,
    sleep = realSleep,
    now = () => new Date(),
  } = config;

  const url = `${baseUrl.replace(/\/$/, "")}/models`;
  const answers = async (): Promise<boolean> => {
    try {
      const response = await doFetch(url);
      return response.ok;
    } catch {
      return false;
    }
  };

  if (await answers()) return;

  exec(startCommand);
  const deadline = now().getTime() + timeoutMs;
  for (;;) {
    await sleep(MODEL_POLL_MS);
    if (await answers()) return;
    if (now().getTime() >= deadline) {
      throw new Error(
        `local model server did not answer ${url} within ${Math.round(timeoutMs / 1000)}s after starting \`${startCommand.join(" ")}\``,
      );
    }
  }
}
