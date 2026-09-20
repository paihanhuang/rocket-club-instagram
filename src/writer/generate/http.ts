/**
 * The OpenAI-compatible adapter: the fallback seam behind `Generate` when the
 * qwen harness misbehaves, and what the live local server (MTPLX) speaks.
 */
import type { Fetch, Generate } from "../../newsroom/ports.js";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";
import { extractJsonObject, isRecord } from "./json.js";

export const TEMPERATURE = 0.4;

export type HttpGenerateConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: Fetch;
};

/** Network-level codes that mean "the server is not there", not "it said no". */
const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "EHOSTUNREACH"]);

function describe(error: unknown): { name: string; message: string; code: string | undefined } {
  const e = error as { name?: unknown; message?: unknown; cause?: { code?: unknown } };
  return {
    name: typeof e?.name === "string" ? e.name : "",
    message: typeof e?.message === "string" ? e.message : String(error),
    code: typeof e?.cause?.code === "string" ? e.cause.code : undefined,
  };
}

function rethrow(error: unknown, url: string, wallTimeMs: number): never {
  const { name, message, code } = describe(error);
  if (name === "TimeoutError" || name === "AbortError") {
    throw new ModelTimeoutError(`The model at ${url} did not answer within ${wallTimeMs}ms.`, error);
  }
  if ((code && UNAVAILABLE_CODES.has(code)) || /fetch failed|connect/i.test(message)) {
    throw new ModelUnavailableError(`Cannot reach the model at ${url}: ${message}`, error);
  }
  throw error;
}

export function httpGenerate(cfg: HttpGenerateConfig): Generate {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch: Fetch = cfg.fetch ?? globalThis.fetch;

  return async ({ system, user, jsonSchema, wallTimeMs }) => {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    const post = async (withSchema: boolean): Promise<Response> => {
      const body: Record<string, unknown> = { model: cfg.model, messages, temperature: TEMPERATURE };
      if (withSchema) {
        body["response_format"] = { type: "json_schema", json_schema: { name: "draft", schema: jsonSchema } };
      }
      try {
        return await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(wallTimeMs),
        });
      } catch (error) {
        rethrow(error, url, wallTimeMs);
      }
    };

    // Not every server understands response_format; a 400 means "ask in prose".
    let response = await post(true);
    if (response.status === 400) response = await post(false);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ModelUnavailableError(`The model at ${url} answered ${response.status}: ${detail.slice(0, 400)}`);
      }
      throw new Error(`The model at ${url} answered ${response.status}: ${detail.slice(0, 400)}`);
    }

    const payload: unknown = await response.json();
    const choices = isRecord(payload) ? payload["choices"] : undefined;
    const first = Array.isArray(choices) ? choices[0] : undefined;
    const message = isRecord(first) ? first["message"] : undefined;

    const content = isRecord(message) && typeof message["content"] === "string" ? message["content"] : "";
    // Reasoning models keep the answer in `content` and the thinking elsewhere;
    // only when `content` came back empty is the thinking worth looking at.
    const reasoning =
      isRecord(message) && typeof message["reasoning_content"] === "string" ? message["reasoning_content"] : "";
    const raw = content.trim() ? content : reasoning;

    return { raw, json: extractJsonObject(raw) };
  };
}
