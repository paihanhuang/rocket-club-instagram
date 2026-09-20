/**
 * Contract test against the real GitHub Pages branch. Skipped unless RUN_LIVE=1:
 *
 *   RUN_LIVE=1 npx vitest run src/imagehost/live.test.ts
 *
 * It measures the one number the publisher's timing depends on: how long after
 * a commit to the Pages branch the URL actually serves an image. GitHub says
 * "up to 10 minutes"
 * (https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site);
 * this is what it costs us in practice. The spike file is removed afterwards,
 * the way the publisher removes slides once Instagram has the media id.
 */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitHubPagesHost } from "./index.js";

/** A 1x1 JPEG: the smallest thing that still has an image content type. */
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
  0x00, 0x60, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09, 0xff, 0xc4, 0x00, 0x14, 0x10,
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x2a, 0x9f, 0xff, 0xd9,
]);

const live = process.env["RUN_LIVE"] ? describe : describe.skip;

live("GitHub Pages, for real", () => {
  it(
    "serves a published JPEG and then forgets it",
    async () => {
      const name = `spike-${Date.now()}.jpg`;
      const dir = await mkdtemp(join(tmpdir(), "pages-spike-"));
      const path = join(dir, name);
      await writeFile(path, TINY_JPEG);

      const host = createGitHubPagesHost({
        owner: "paihanhuang",
        repo: "rocket-club-instagram",
        branch: "gh-pages",
        dir: "media",
        siteBase: "https://paihanhuang.github.io/rocket-club-instagram",
        fetch,
      });

      const [url] = await host.publish([{ name, path }]);
      expect(url).toBe(`https://paihanhuang.github.io/rocket-club-instagram/media/${name}`);

      const startedAt = Date.now();
      await host.waitUntilServed([url!]);
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;

      const served = await fetch(`${url!}?cb=verify`, { headers: { "cache-control": "no-cache" } });
      expect(served.status).toBe(200);
      expect(served.headers.get("content-type")).toMatch(/^image\//);

      await host.remove([name]);

      // eslint-disable-next-line no-console
      console.log(`GitHub Pages time to served: ${seconds}s (polled every 10s) for ${name}`);
      await mkdir("out", { recursive: true });
      await writeFile(
        "out/pages-spike.json",
        `${JSON.stringify({ name, url, seconds, pollIntervalSeconds: 10, at: new Date().toISOString() }, null, 2)}\n`,
      );
    },
    15 * 60_000,
  );
});
