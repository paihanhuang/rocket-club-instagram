import { describe, expect, it } from "vitest";
import { verdictMatches } from "./index.js";

const HASH = "abcdef123456" + "0".repeat(52);
const verdict = (contentHash: string) => ({ decision: "approved" as const, by: "officer", at: "2026-09-26T20:00:00.000Z", contentHash });

describe("verdictMatches", () => {
  it("accepts the 12-character reference the card printed", () => {
    expect(verdictMatches(HASH, verdict("abcdef123456"))).toBe(true);
  });
  it("accepts the full hash", () => {
    expect(verdictMatches(HASH, verdict(HASH))).toBe(true);
  });
  it("refuses a reference to different content", () => {
    expect(verdictMatches(HASH, verdict("ffffff000000"))).toBe(false);
  });
  it("refuses an empty or too-short reference", () => {
    expect(verdictMatches(HASH, verdict(""))).toBe(false);
    expect(verdictMatches(HASH, verdict("abcdef"))).toBe(false);
  });
});
