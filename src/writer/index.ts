/**
 * The writer: one assignment and one shortlist in, one validated DraftText out.
 *
 * Behind the seam: the guides, the prompt, the choice of harness, and the
 * invariants. The model is asked at most twice, and is never trusted about the
 * source line, the hashtags, the slide count or the flags — the writer enforces
 * those itself after every answer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { draftTextSchema } from "../newsroom/schemas.js";
import type { Fetch, Generate } from "../newsroom/ports.js";
import type { Assignment, DraftText, LicensedPhoto, Shortlist } from "../newsroom/types.js";
import { type DraftAttempt, DraftInvalidError, ModelTimeoutError, ModelUnavailableError } from "./errors.js";
import { fakeGenerate } from "./generate/fake.js";
import { httpGenerate } from "./generate/http.js";
import { qwenGenerate } from "./generate/qwen.js";
import { normalizeDraft } from "./normalize.js";
import { assemblePrompt, type Guides } from "./prompt.js";

export { DraftInvalidError, ModelTimeoutError, ModelUnavailableError, type DraftAttempt } from "./errors.js";
export { fakeGenerate, type FakeGenerate, type GenerateRequest } from "./generate/fake.js";
export { httpGenerate, type HttpGenerateConfig } from "./generate/http.js";
export { withFallback } from "./generate/fallback.js";
export { parseQwenStdout, qwenGenerate } from "./generate/qwen.js";
export {
  assemblePrompt,
  type AssembledPrompt,
  CAPTION_STRUCTURE,
  type Guides,
  JSON_ONLY,
  PILLAR_NOTES,
  type PromptInput,
  renderItem,
  renderShortlist,
} from "./prompt.js";
export {
  CONFIRM_FLAG,
  needsConfirmFlag,
  normalizeDraft,
  normalizeFlags,
  normalizeHashtags,
  PILLAR_HASHTAGS,
  REQUIRED_HASHTAGS,
} from "./normalize.js";

/** Which harness writes the draft. */
export type ModelChoice =
  | { kind: "qwen"; bin?: string }
  | { kind: "http"; baseUrl: string; apiKey: string; model: string }
  | { kind: "fake"; replies: unknown[] };

export type WriterConfig = {
  model: ModelChoice | "auto";
  guidesDir: string;
  wallTimeMs?: number;
  /** Injected for the "auto" probe and the http adapter; production uses the global. */
  fetch?: Fetch;
  /** Injected for tests; production uses process.env. */
  env?: Record<string, string | undefined>;
};

export type Writer = {
  writeDraft(assignment: Assignment, shortlist: Shortlist, photo?: LicensedPhoto): Promise<DraftText>;
};

export const DEFAULT_WALL_TIME_MS = 300_000;
export const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:18085/v1";
export const DEFAULT_LOCAL_API_KEY = "local-no-auth";
export const DEFAULT_LOCAL_MODEL = "mtplx-qwen38-27b-optimized-quality";
/** How long the "auto" probe waits for /models before falling back to qwen. */
export const PROBE_TIMEOUT_MS = 3_000;

/** The sentence that carries the first attempt's zod issues into the second call. */
export function retryInstruction(attempt: DraftAttempt): string {
  return [
    "Your previous answer was:",
    attempt.raw.slice(0, 2000),
    "",
    `Your previous answer failed validation: ${JSON.stringify(attempt.issues)}. Return corrected JSON only.`,
  ].join("\n");
}

/**
 * The writer over an already-chosen `Generate`. `createWriter` is this plus the
 * guides and the choice of harness; tests use it directly with a fake so they
 * can read back the requests.
 */
export function writerWith(generate: Generate, opts: { guides: Guides; wallTimeMs?: number }): Writer {
  const wallTimeMs = opts.wallTimeMs ?? DEFAULT_WALL_TIME_MS;

  return {
    async writeDraft(assignment, shortlist, photo) {
      const { system, user, jsonSchema } = assemblePrompt({
        assignment,
        shortlist,
        ...(photo ? { photo } : {}),
        guides: opts.guides,
      });

      const attempts: DraftAttempt[] = [];

      // At most two calls: the first ask, then one correction carrying the issues.
      for (let attempt = 0; attempt < 2; attempt++) {
        const previous = attempts[attempt - 1];
        const message = previous ? `${user}\n\n${retryInstruction(previous)}` : user;

        const { raw, json } = await generate({ system, user: message, jsonSchema, wallTimeMs });
        const parsed = draftTextSchema.safeParse(normalizeDraft(json, { assignment, shortlist }));
        if (parsed.success) return parsed.data;

        attempts.push({ raw, issues: parsed.error.issues });
      }

      throw new DraftInvalidError(attempts);
    },
  };
}

/** The voice guide and the fence, read once. */
export function readGuides(guidesDir: string): Guides {
  return {
    voice: readFileSync(join(guidesDir, "voice.md"), "utf8"),
    fence: readFileSync(join(guidesDir, "fence.md"), "utf8"),
  };
}

/**
 * "auto": the local server if it answers /models, otherwise the qwen harness,
 * which talks to whatever its own settings point at. Exported because which
 * harness a run picked is worth asserting.
 */
export async function resolveModelChoice(cfg: WriterConfig): Promise<ModelChoice> {
  const env = cfg.env ?? process.env;
  const baseUrl = (env["LOCAL_LLM_BASE_URL"] || DEFAULT_LOCAL_BASE_URL).replace(/\/+$/, "");
  const doFetch: Fetch = cfg.fetch ?? globalThis.fetch;
  try {
    const response = await doFetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (response.ok) {
      return {
        kind: "http",
        baseUrl,
        apiKey: env["LOCAL_LLM_API_KEY"] || DEFAULT_LOCAL_API_KEY,
        model: env["LOCAL_LLM_MODEL"] || DEFAULT_LOCAL_MODEL,
      };
    }
  } catch {
    // Nothing there: fall back to the harness and its own model settings.
  }
  return { kind: "qwen" };
}

function adapterFor(choice: ModelChoice, cfg: WriterConfig): Generate {
  switch (choice.kind) {
    case "qwen":
      return qwenGenerate(choice.bin ? { bin: choice.bin } : {});
    case "http":
      return httpGenerate({
        baseUrl: choice.baseUrl,
        apiKey: choice.apiKey,
        model: choice.model,
        ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
      });
    case "fake":
      return fakeGenerate(choice.replies);
  }
}

/**
 * Reads the guides once, then hands back a writer. The harness is chosen on the
 * first draft (the "auto" probe is a network call, and this is not async).
 */
export function createWriter(cfg: WriterConfig): Writer {
  const guides = readGuides(cfg.guidesDir);
  const wallTimeMs = cfg.wallTimeMs ?? DEFAULT_WALL_TIME_MS;

  let chosen: Promise<Generate> | undefined;
  const generate: Generate = async (request) => {
    chosen ??= (cfg.model === "auto" ? resolveModelChoice(cfg) : Promise.resolve(cfg.model)).then((choice) =>
      adapterFor(choice, cfg),
    );
    return (await chosen)(request);
  };

  return writerWith(generate, { guides, wallTimeMs });
}
