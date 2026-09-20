import { describe, expect, it } from "vitest";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";
import { httpGenerate } from "./http.js";

const request = {
  system: "system text",
  user: "user text",
  jsonSchema: { type: "object", properties: { headline: { type: "string" } }, required: ["headline"] },
  wallTimeMs: 5_000,
};

type Call = { url: string; body: Record<string, unknown> };

function stubFetch(responses: (() => Response | Promise<Response>)[]): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchStub = (async (input: RequestInfo | URL, init: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const next = queue.shift();
    if (!next) throw new Error("stubFetch ran out of responses");
    return next();
  }) as unknown as typeof fetch;
  return { fetch: fetchStub, calls };
}

const completion = (content: string, extra: Record<string, unknown> = {}): Response =>
  new Response(JSON.stringify({ choices: [{ message: { content, ...extra } }] }), { status: 200 });

const cfg = { baseUrl: "http://127.0.0.1:18085/v1", apiKey: "local-no-auth", model: "local-model" };

describe("httpGenerate", () => {
  it("posts one system and one user message to /chat/completions", async () => {
    const { fetch, calls } = stubFetch([() => completion('{"headline":"ok"}')]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(calls[0]?.url).toBe("http://127.0.0.1:18085/v1/chat/completions");
    expect(calls[0]?.body["model"]).toBe("local-model");
    expect(calls[0]?.body["temperature"]).toBe(0.4);
    expect(calls[0]?.body["messages"]).toEqual([
      { role: "system", content: "system text" },
      { role: "user", content: "user text" },
    ]);
    expect(result.json).toEqual({ headline: "ok" });
    expect(result.raw).toBe('{"headline":"ok"}');
  });

  it("asks for the schema through response_format", async () => {
    const { fetch, calls } = stubFetch([() => completion('{"headline":"ok"}')]);
    await httpGenerate({ ...cfg, fetch })(request);

    expect(calls[0]?.body["response_format"]).toEqual({
      type: "json_schema",
      json_schema: { name: "draft", schema: request.jsonSchema },
    });
  });

  it("does not care about a trailing slash on the base url", async () => {
    const { fetch, calls } = stubFetch([() => completion('{"headline":"ok"}')]);
    await httpGenerate({ ...cfg, baseUrl: "http://127.0.0.1:18085/v1/", fetch })(request);

    expect(calls[0]?.url).toBe("http://127.0.0.1:18085/v1/chat/completions");
  });

  it("retries once without response_format when the server rejects it", async () => {
    const { fetch, calls } = stubFetch([
      () => new Response(JSON.stringify({ error: "response_format is not supported" }), { status: 400 }),
      () => completion('{"headline":"ok"}'),
    ]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toHaveProperty("response_format");
    expect(calls[1]?.body).not.toHaveProperty("response_format");
    expect(calls[1]?.body["temperature"]).toBe(0.4);
    expect(result.json).toEqual({ headline: "ok" });
  });

  it("gives up if the retry is rejected too", async () => {
    const { fetch } = stubFetch([
      () => new Response("bad request", { status: 400 }),
      () => new Response("bad request", { status: 400 }),
    ]);

    await expect(httpGenerate({ ...cfg, fetch })(request)).rejects.toThrow(/400/);
  });

  it("strips a fenced code block", async () => {
    const { fetch } = stubFetch([() => completion('Here you go:\n```json\n{"headline":"fenced"}\n```\n')]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(result.json).toEqual({ headline: "fenced" });
  });

  it("ignores a <think> block and takes the answer after it", async () => {
    const content = '<think>\nThe user wants {"headline":"wrong"} maybe.\n</think>\n{"headline":"right"}';
    const { fetch } = stubFetch([() => completion(content)]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(result.json).toEqual({ headline: "right" });
  });

  it("ignores an unclosed <think> block", async () => {
    const content = '{"headline":"right"}\n<think>and then it rambled {"headline":"wrong"}';
    const { fetch } = stubFetch([() => completion(content)]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(result.json).toEqual({ headline: "right" });
  });

  it("falls back to reasoning_content only when content came back empty", async () => {
    const { fetch } = stubFetch([() => completion("", { reasoning_content: '{"headline":"from reasoning"}' })]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(result.json).toEqual({ headline: "from reasoning" });
  });

  it("reports no json rather than inventing one", async () => {
    const { fetch } = stubFetch([() => completion("I am afraid I cannot do that.")]);
    const result = await httpGenerate({ ...cfg, fetch })(request);

    expect(result.json).toBeUndefined();
    expect(result.raw).toBe("I am afraid I cannot do that.");
  });

  it("turns a refused connection into ModelUnavailableError", async () => {
    const fetchStub = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;

    await expect(httpGenerate({ ...cfg, fetch: fetchStub })(request)).rejects.toThrow(ModelUnavailableError);
  });

  it("turns a 503 into ModelUnavailableError", async () => {
    const { fetch } = stubFetch([() => new Response("overloaded", { status: 503 })]);

    await expect(httpGenerate({ ...cfg, fetch })(request)).rejects.toThrow(ModelUnavailableError);
  });

  it("turns an aborted request into ModelTimeoutError", async () => {
    const fetchStub = (async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;

    await expect(httpGenerate({ ...cfg, fetch: fetchStub })(request)).rejects.toThrow(ModelTimeoutError);
  });

  it("passes an abort signal so the wall time is real", async () => {
    let signal: AbortSignal | undefined;
    const fetchStub = (async (_input: unknown, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return completion('{"headline":"ok"}');
    }) as unknown as typeof fetch;

    await httpGenerate({ ...cfg, fetch: fetchStub })(request);

    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
