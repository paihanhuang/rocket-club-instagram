/**
 * The qwen code adapter: the CLI run headless, with tools off, and its answer
 * forced through the draft schema by `--json-schema`.
 *
 * The command that works (qwen 0.24.1):
 *
 *   qwen "<user prompt>" --system-prompt "<system prompt>" \
 *        --max-tool-calls 0 --json-schema @/tmp/…/schema.json \
 *        --max-wall-time 300 --output-format json
 *
 * The model comes from qwen's own settings, so nothing here picks one. Exit 55
 * is qwen's abort code for the wall-time and tool-call budgets.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Generate } from "../../newsroom/ports.js";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";
import { extractJsonObject, isRecord, jsonObjectsIn, stripCodeFences, stripThinkBlocks } from "./json.js";

/** qwen aborts with this code when --max-wall-time or --max-tool-calls is exceeded. */
export const QWEN_ABORT_EXIT_CODE = 55;

/** Keys a harness wraps the payload in, most specific first. */
const ENVELOPE_KEYS = ["structured_output", "structuredOutput", "result", "response", "output", "content", "json", "data"];

function unwrap(object: Record<string, unknown>, expect: readonly string[]): Record<string, unknown> {
  if (expect.length > 0 && expect.every((key) => key in object)) return object;
  for (const key of ENVELOPE_KEYS) {
    const value = object[key];
    if (isRecord(value)) return unwrap(value, expect);
    if (typeof value === "string") {
      const parsed = extractJsonObject(value);
      if (parsed) return unwrap(parsed, expect);
    }
  }
  return object;
}

/** The payload out of qwen's `--output-format json` event array, newest first. */
function fromEvents(events: unknown[], expect: readonly string[]): Record<string, unknown> | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!isRecord(event)) continue;

    if (event["type"] === "result" && event["is_error"] !== true) {
      const result = event["result"];
      if (isRecord(result)) return unwrap(result, expect);
      if (typeof result === "string") {
        const parsed = extractJsonObject(result);
        if (parsed) return unwrap(parsed, expect);
      }
    }

    const message = event["message"];
    if (isRecord(message) && Array.isArray(message["content"])) {
      for (let j = message["content"].length - 1; j >= 0; j--) {
        const block: unknown = message["content"][j];
        if (!isRecord(block) || block["type"] !== "tool_use") continue;
        const input = block["input"];
        if (isRecord(input)) return unwrap(input, expect);
      }
    }
  }
  return undefined;
}

/**
 * Pure: qwen's stdout in, the draft object out. Handles the event array from
 * `--output-format json`, a bare envelope object, and plain text with the JSON
 * somewhere in it. `expect` names the keys the payload must have, which lets
 * the parser tell the payload from the envelope around it.
 */
export function parseQwenStdout(stdout: string, opts: { expect?: readonly string[] } = {}): { raw: string; json: unknown } {
  const expect = opts.expect ?? [];
  const raw = stdout;

  let whole: unknown;
  try {
    whole = JSON.parse(stdout.trim());
  } catch {
    whole = undefined;
  }

  if (Array.isArray(whole)) {
    const found = fromEvents(whole, expect);
    if (found) return { raw, json: found };
  } else if (isRecord(whole)) {
    return { raw, json: unwrap(whole, expect) };
  }

  const objects = jsonObjectsIn(stripThinkBlocks(stripCodeFences(stdout)));
  for (let i = objects.length - 1; i >= 0; i--) {
    const object = objects[i];
    if (object) return { raw, json: unwrap(object, expect) };
  }

  return { raw, json: undefined };
}

function requiredKeys(jsonSchema: Record<string, unknown>): string[] {
  const required = jsonSchema["required"];
  return Array.isArray(required) ? required.filter((key): key is string => typeof key === "string") : [];
}

type RunResult = { code: number | null; stdout: string; stderr: string; killed: boolean };

function run(bin: string, args: string[], hardTimeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, hardTimeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        reject(new ModelUnavailableError(`The qwen code CLI (${bin}) is not on PATH.`, error));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed });
    });
  });
}

function tail(text: string, max = 800): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `…${trimmed.slice(-max)}`;
}

export function qwenGenerate(opts: { bin?: string; extraArgs?: readonly string[] } = {}): Generate {
  const bin = opts.bin ?? "qwen";
  const extraArgs = opts.extraArgs ?? [];

  return async ({ system, user, jsonSchema, wallTimeMs }) => {
    const dir = await mkdtemp(join(tmpdir(), "lahs-writer-"));
    const schemaPath = join(dir, "schema.json");
    try {
      await writeFile(schemaPath, JSON.stringify(jsonSchema), "utf8");
      const seconds = Math.max(1, Math.ceil(wallTimeMs / 1000));
      const args = qwenArgs({ user, system, schemaPath, seconds, extraArgs });

      const result = await run(bin, args, wallTimeMs + 30_000);

      if (result.killed) {
        throw new ModelTimeoutError(`qwen did not answer within ${wallTimeMs}ms and was killed.`);
      }
      if (result.code === QWEN_ABORT_EXIT_CODE) {
        throw new ModelTimeoutError(
          `qwen aborted on its wall-time or tool-call budget (exit 55) after ${seconds}s. ${tail(result.stderr)}`,
        );
      }
      if (result.code !== 0) {
        // A non-zero exit with a usable payload is still the model's answer.
        // Without one, the harness itself failed (a CLI banner, a bad flag, a
        // missing setting), which is what the HTTP fallback exists for.
        let parsed: ReturnType<typeof parseQwenStdout> | undefined;
        try {
          parsed = parseQwenStdout(result.stdout, { expect: requiredKeys(jsonSchema) });
        } catch {
          parsed = undefined;
        }
        if (parsed?.json !== undefined) return parsed;
        throw new ModelUnavailableError(`qwen exited with code ${result.code}: ${tail(result.stderr)}`);
      }

      return parseQwenStdout(result.stdout, { expect: requiredKeys(jsonSchema) });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

/**
 * The exact qwen code command line: headless, no tools, schema-bound output,
 * and `--safe-mode` so no context file, skill, hook or extension is loaded
 * (measured: it halves the time per call and removes the harness's own
 * project context from the prompt).
 */
function qwenArgs(input: {
  user: string;
  system: string;
  schemaPath: string;
  seconds: number;
  extraArgs?: readonly string[];
}): string[] {
  return [
    input.user,
    "--system-prompt",
    input.system,
    "--safe-mode",
    "--max-tool-calls",
    "0",
    "--json-schema",
    `@${input.schemaPath}`,
    "--max-wall-time",
    String(input.seconds),
    "--output-format",
    "json",
    ...(input.extraArgs ?? []),
  ];
}
