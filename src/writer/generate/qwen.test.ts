import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";
import { parseQwenStdout, qwenGenerate } from "./qwen.js";

const EXPECT = { expect: ["headline", "caption"] };
const payload = { headline: "Falcon 9 flies Monday night", caption: "Body. Source: Launch Library." };

/** What `qwen --output-format json --json-schema …` actually prints, trimmed. */
const eventStdout = (over: { result?: unknown; toolInput?: unknown } = {}): string =>
  JSON.stringify([
    { type: "system", subtype: "init", session_id: "s1", model: "mtplx-qwen38-27b-optimized-quality", tools: ["structured_output"] },
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", thinking: "This matches the structured_output schema." }] },
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "structured_output", input: over.toolInput ?? payload }],
      },
    },
    {
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", is_error: false, content: "Structured output accepted." }] },
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 48042,
      result: over.result ?? JSON.stringify(payload),
      stats: { models: { "mtplx-qwen36-27b-optimized-speed": { api: { totalRequests: 2 } } } },
    },
  ]);

describe("parseQwenStdout", () => {
  it("takes the payload out of the final result event", () => {
    const parsed = parseQwenStdout(eventStdout(), EXPECT);

    expect(parsed.json).toEqual(payload);
    expect(parsed.raw).toContain('"type":"result"');
  });

  it("falls back to the structured_output tool call when there is no result event", () => {
    const events = JSON.parse(eventStdout()) as unknown[];
    const stdout = JSON.stringify(events.filter((e) => (e as { type: string }).type !== "result"));

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("accepts a result event whose result is already an object", () => {
    expect(parseQwenStdout(eventStdout({ result: payload }), EXPECT).json).toEqual(payload);
  });

  it("unwraps a fenced payload inside the result string", () => {
    const stdout = eventStdout({ result: "```json\n" + JSON.stringify(payload) + "\n```" });

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("reads a bare payload object", () => {
    expect(parseQwenStdout(JSON.stringify(payload), EXPECT).json).toEqual(payload);
  });

  it("reads a single-object envelope", () => {
    const stdout = JSON.stringify({ response: JSON.stringify(payload), stats: { turns: 1 } });

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("finds the final JSON object when log lines come first", () => {
    const stdout = [
      "[qwen] loading settings",
      "[qwen] model mtplx-qwen38-27b-optimized-quality",
      "",
      "```json",
      JSON.stringify(payload),
      "```",
      "",
    ].join("\n");

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("prefers the last JSON object when the model printed two", () => {
    const first = { headline: "an earlier draft", caption: "old" };
    const stdout = `${JSON.stringify(first)}\nOn reflection:\n${JSON.stringify(payload)}\n`;

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("keeps a payload that happens to have an envelope-looking key", () => {
    const withContent = { ...payload, content: "not an envelope" };

    expect(parseQwenStdout(JSON.stringify(withContent), EXPECT).json).toEqual(withContent);
  });

  it("strips a think block before looking for JSON", () => {
    const stdout = `<think>I could answer ${JSON.stringify({ headline: "wrong", caption: "wrong" })}</think>\n${JSON.stringify(payload)}`;

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });

  it("reports no json, with the raw text kept, when the output has none", () => {
    const parsed = parseQwenStdout("qwen: nothing to do\n", EXPECT);

    expect(parsed.json).toBeUndefined();
    expect(parsed.raw).toBe("qwen: nothing to do\n");
  });

  it("ignores a brace in prose that is not JSON", () => {
    const stdout = `The set {a, b} is not JSON. ${JSON.stringify(payload)}`;

    expect(parseQwenStdout(stdout, EXPECT).json).toEqual(payload);
  });
});

describe("qwenGenerate", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  const request = {
    system: "system text",
    user: "user text",
    jsonSchema: { type: "object", properties: { headline: {}, caption: {} }, required: ["headline", "caption"] },
    wallTimeMs: 30_000,
  };

  async function stubBin(script: string): Promise<{ bin: string; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), "lahs-qwen-stub-"));
    dirs.push(dir);
    const bin = join(dir, "qwen-stub");
    await writeFile(bin, script, "utf8");
    await chmod(bin, 0o755);
    return { bin, dir };
  }

  it("says the harness is unavailable when the binary is not there", async () => {
    await expect(qwenGenerate({ bin: "definitely-not-a-real-binary-9f3a" })(request)).rejects.toThrow(
      ModelUnavailableError,
    );
  });

  it("turns exit 55 into ModelTimeoutError", async () => {
    const { bin } = await stubBin('#!/bin/sh\necho "wall time exceeded" >&2\nexit 55\n');

    await expect(qwenGenerate({ bin })(request)).rejects.toThrow(ModelTimeoutError);
  });

  it("reports any other non-zero exit with its stderr", async () => {
    const { bin } = await stubBin('#!/bin/sh\necho "no model configured" >&2\nexit 1\n');

    await expect(qwenGenerate({ bin })(request)).rejects.toThrow(/no model configured/);
  });

  it("runs headless with tools off, the schema on disk and the wall time in seconds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lahs-qwen-args-"));
    dirs.push(dir);
    const argsFile = join(dir, "args.txt");
    const { bin } = await stubBin(
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${argsFile}\ncat <<'JSON'\n${eventStdout()}\nJSON\n`,
    );

    const result = await qwenGenerate({ bin })(request);
    const args = (await readFile(argsFile, "utf8")).trim().split("\n");

    expect(result.json).toEqual(payload);
    expect(args[0]).toBe("user text");
    expect(args).toContain("--system-prompt");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("system text");
    expect(args[args.indexOf("--max-tool-calls") + 1]).toBe("0");
    expect(args[args.indexOf("--max-wall-time") + 1]).toBe("30");
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");

    const schemaArg = args[args.indexOf("--json-schema") + 1] ?? "";
    expect(schemaArg.startsWith("@")).toBe(true);
  });

  it("writes the schema where --json-schema points, then cleans it up", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lahs-qwen-schema-"));
    dirs.push(dir);
    const copy = join(dir, "schema-copy.json");
    const { bin } = await stubBin(
      `#!/bin/sh\nwhile [ "$1" != "--json-schema" ]; do shift; done\ncp "\${2#@}" ${copy}\ncat <<'JSON'\n${eventStdout()}\nJSON\n`,
    );

    await qwenGenerate({ bin })(request);

    expect(JSON.parse(await readFile(copy, "utf8"))).toEqual(request.jsonSchema);
  });
});
