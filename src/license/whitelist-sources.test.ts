import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, Shortlist } from "../newsroom/types.js";
import { findLicensedPhoto } from "./index.js";

const bytes = (async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof globalThis.fetch;

function shortlistWith(image: NonNullable<Item["images"]>[number], pillar: Shortlist["assignment"]["pillar"] = "launches"): Shortlist {
  const assignment = { date: "2026-09-28", pillar, angle: "this week" };
  const item: Item = { id: "i", source: image.source, title: "t", url: "https://example.test", summary: "", fetchedAt: "2026-09-27T03:30:00.000Z", images: [image] };
  return { assignment, items: [item], notes: [] };
}

describe("the whitelist is a list of sources, not of licence tags", () => {
  it("rejects a Creative Commons tag on an image from a source the fence does not name", async () => {
    const photoDir = await mkdtemp(join(tmpdir(), "photos-"));
    const image = { url: "https://news.example.com/rocket.jpg", license: "CC BY 4.0", credit: "Someone", source: "rss" };
    expect(await findLicensedPhoto(shortlistWith(image), { fetch: bytes, photoDir })).toBeUndefined();
  });

  it("accepts a Launch Library image whose curated licence is CC BY", async () => {
    const photoDir = await mkdtemp(join(tmpdir(), "photos-"));
    const image = { url: "https://thespacedevs-prod.nyc3.digitaloceanspaces.com/media/images/falcon.jpg", license: "CC BY 4.0", credit: "SpaceX", source: "launchlibrary" };
    const photo = await findLicensedPhoto(shortlistWith(image), { fetch: bytes, photoDir });
    expect(photo?.license).toBe("CC BY 4.0");
  });

  it("accepts an ESA image with a CC BY-SA IGO licence", async () => {
    const photoDir = await mkdtemp(join(tmpdir(), "photos-"));
    const image = { url: "https://www.esa.int/var/esa/storage/images/ariane6.jpg", license: "CC BY-SA 3.0 IGO", credit: "ESA", source: "rss" };
    const photo = await findLicensedPhoto(shortlistWith(image), { fetch: bytes, photoDir });
    expect(photo?.license).toBe("CC BY-SA 3.0 IGO");
  });

  it("rejects an ESA-hosted image with no stated licence", async () => {
    const photoDir = await mkdtemp(join(tmpdir(), "photos-"));
    const image = { url: "https://www.esa.int/var/esa/storage/images/mystery.jpg", credit: "ESA", source: "rss" };
    expect(await findLicensedPhoto(shortlistWith(image), { fetch: bytes, photoDir })).toBeUndefined();
  });
});
