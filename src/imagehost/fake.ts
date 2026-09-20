/**
 * A recording image host for tests: it answers like the real one and never
 * touches the network or GitHub.
 */
import type { ImageHostPort } from "../newsroom/ports.js";

export type FakeImageHost = ImageHostPort & {
  readonly published: { name: string; path: string }[];
  readonly waited: string[][];
  readonly removed: string[];
  readonly calls: ("publish" | "waitUntilServed" | "remove")[];
};

/** Records every call, never touches the network. */
export function createFakeImageHost(base = "https://fake.local/media"): FakeImageHost {
  const published: { name: string; path: string }[] = [];
  const waited: string[][] = [];
  const removed: string[] = [];
  const calls: ("publish" | "waitUntilServed" | "remove")[] = [];
  return {
    published,
    waited,
    removed,
    calls,
    async publish(files) {
      calls.push("publish");
      published.push(...files.map((f) => ({ name: f.name, path: f.path })));
      return files.map((f) => `${base}/${f.name}`);
    },
    async waitUntilServed(urls) {
      calls.push("waitUntilServed");
      waited.push([...urls]);
    },
    async remove(names) {
      calls.push("remove");
      removed.push(...names);
    },
  };
}
