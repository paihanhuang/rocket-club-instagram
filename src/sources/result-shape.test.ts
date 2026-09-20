import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchItems } from "./index.js";

describe("fetchItems", () => {
  it("returns the items and the notes as one explicit result", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "cache-"));
    const never = (async () => {
      throw new Error("no network in this test");
    }) as unknown as typeof globalThis.fetch;
    // The explainer has no sources, so this needs no network and no fixtures.
    const result = await fetchItems("explainer", { now: new Date("2026-09-25T03:30:00.000Z"), fetch: never, cacheDir });
    expect(result).toEqual({ items: [], notes: [] });
  });
});
