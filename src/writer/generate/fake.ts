/**
 * The scripted adapter. Tests hand it the answers in order and read back the
 * requests the writer made, so the whole module can be tested without a model.
 */
import type { Generate } from "../../newsroom/ports.js";
import { extractJsonObject } from "./json.js";

export type GenerateRequest = Parameters<Generate>[0];

export type FakeGenerate = Generate & { readonly calls: GenerateRequest[] };

/**
 * A reply may be an object (handed back as the parsed JSON), a string (parsed
 * the way a real answer would be) or an Error (thrown, for the failure paths).
 */
export function fakeGenerate(replies: readonly unknown[]): FakeGenerate {
  const calls: GenerateRequest[] = [];
  const queue = [...replies];

  const generate: Generate = async (request) => {
    calls.push(request);
    if (queue.length === 0) {
      throw new Error(`fakeGenerate ran out of scripted replies after ${calls.length} call(s).`);
    }
    const reply = queue.shift();
    if (reply instanceof Error) throw reply;
    if (typeof reply === "string") return { raw: reply, json: extractJsonObject(reply) };
    return { raw: JSON.stringify(reply), json: reply };
  };

  return Object.assign(generate, { calls });
}
