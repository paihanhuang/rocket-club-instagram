/**
 * Getting a JSON object out of whatever a local model actually printed:
 * ``` fences, <think> blocks, log lines, and harness envelopes around the
 * payload. Pure functions, so the awkward cases are unit-testable.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Removes reasoning. Handles the balanced case and both half-open cases, which
 * happen when a server trims one side of the pair.
 */
export function stripThinkBlocks(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = out.toLowerCase().lastIndexOf("</think>");
  if (close !== -1) out = out.slice(close + "</think>".length);
  const open = out.toLowerCase().indexOf("<think>");
  if (open !== -1) out = out.slice(0, open);
  return out;
}

/** Drops ``` and ```json fence lines, keeping what is between them. */
export function stripCodeFences(text: string): string {
  return text.replace(/^[ \t]*```[a-zA-Z0-9_-]*[ \t]*$/gm, "");
}

/** Index of the `}` closing the `{` at `start`, or -1. Strings and escapes respected. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Every top-level JSON object in `text`, in order. A `{` that does not start
 * valid JSON (prose, a brace in a sentence) is skipped rather than swallowing
 * the rest of the text.
 */
export function jsonObjectsIn(text: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    const end = balancedEnd(text, i);
    if (end === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(i, end + 1));
      if (isRecord(value)) {
        found.push(value);
        i = end;
      }
    } catch {
      // Not JSON after all: keep scanning from the next character.
    }
  }
  return found;
}

/** Cleans the text, then returns the first JSON object in it. */
export function extractJsonObject(text: string): Record<string, unknown> | undefined {
  return jsonObjectsIn(stripThinkBlocks(stripCodeFences(text)))[0];
}
