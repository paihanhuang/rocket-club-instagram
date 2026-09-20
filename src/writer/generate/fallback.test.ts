import { describe, expect, it } from "vitest";
import type { Generate } from "../../newsroom/ports.js";
import { ModelTimeoutError, ModelUnavailableError } from "../errors.js";
import { withFallback } from "./fallback.js";

const request = { system: "s", user: "u", jsonSchema: {}, wallTimeMs: 1000 };
const answer = { raw: "{}", json: {} };
const ok: Generate = async () => answer;
const unavailable: Generate = async () => {
  throw new ModelUnavailableError("qwen is not installed");
};
const slow: Generate = async () => {
  throw new ModelTimeoutError("qwen took too long");
};
const broken: Generate = async () => {
  throw new Error("something else entirely");
};

describe("withFallback", () => {
  it("uses the primary when it answers", async () => {
    let fell = 0;
    const generate = withFallback(ok, async () => {
      fell += 1;
      return answer;
    });
    expect(await generate(request)).toBe(answer);
    expect(fell).toBe(0);
  });

  it("falls back when the primary is unavailable, and says why", async () => {
    const reasons: string[] = [];
    const generate = withFallback(unavailable, ok, (error) => reasons.push(error.message));
    expect(await generate(request)).toBe(answer);
    expect(reasons).toEqual(["qwen is not installed"]);
  });

  it("falls back when the primary times out", async () => {
    expect(await withFallback(slow, ok)(request)).toBe(answer);
  });

  it("does not hide any other error behind the fallback", async () => {
    let fell = 0;
    const generate = withFallback(broken, async () => {
      fell += 1;
      return answer;
    });
    await expect(generate(request)).rejects.toThrow("something else entirely");
    expect(fell).toBe(0);
  });
});
