/**
 * Tests for the licence module, through `findLicensedPhoto` only. The Commons
 * responses are real, recorded by `tests/fixtures/record.ts`; the image bytes
 * are a few fake ones, because nothing here looks inside a JPEG.
 */
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeFetch, type Route } from "../../tests/fixtures/fake-fetch.js";
import type { Fetch, PhotoStore } from "../newsroom/ports.js";
import type { Assignment, Item, LicensedPhoto, Pillar, Shortlist } from "../newsroom/types.js";
import { findLicensedPhoto } from "./index.js";

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 7]);

const IMAGE_ROUTE: Route = { match: "://", body: BYTES, contentType: "image/jpeg" };

type Image = NonNullable<Item["images"]>[number];

let photoDir: string;

beforeEach(async () => {
  photoDir = await mkdtemp(join(tmpdir(), "newsroom-photos-"));
});

afterEach(async () => {
  await rm(photoDir, { recursive: true, force: true });
});

function assignment(pillar: Pillar): Assignment {
  return { date: "2026-09-24", pillar, angle: "an angle" };
}

function listOf(images: Image[][], pillar: Pillar = "launches"): Shortlist {
  return {
    assignment: assignment(pillar),
    items: images.map((forItem, n) => ({
      id: `item-${n}`,
      source: "test",
      title: `Item ${n}`,
      url: "https://example.test/item",
      summary: "",
      fetchedAt: "2026-09-23T19:00:00Z",
      images: forItem,
    })),
    notes: [],
  };
}

/** One item, one image: the common case. */
function one(image: Image, pillar: Pillar = "launches"): Shortlist {
  return listOf([[image]], pillar);
}

function clubStore(photos: LicensedPhoto[]): PhotoStore {
  return { listClubPhotos: async () => photos };
}

describe("club photos", () => {
  const consented: LicensedPhoto = {
    url: "file:///club/build-night.jpg",
    license: "Club photo, consent on file",
    credit: "LAHS Rocketry",
    source: "club",
    path: "/club/build-night.jpg",
  };

  it("uses the first consented club photo for the club pillar, without fetching", async () => {
    const fetch = fakeFetch([]);
    const shortlist = one({ url: "https://images-assets.nasa.gov/a.jpg", source: "nasa" }, "club");

    const photo = await findLicensedPhoto(shortlist, {
      fetch,
      photoDir,
      clubPhotos: clubStore([consented, { ...consented, path: "/club/other.jpg" }]),
    });

    expect(photo).toEqual(consented);
    expect(fetch.calls).toHaveLength(0);
  });

  it("falls through to the item images when there are no club photos", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const shortlist = one({ url: "https://images-assets.nasa.gov/a.jpg", source: "nasa" }, "club");

    const photo = await findLicensedPhoto(shortlist, {
      fetch,
      photoDir,
      clubPhotos: clubStore([]),
    });

    expect(photo?.url).toBe("https://images-assets.nasa.gov/a.jpg");
  });

  it("ignores club photos on every other pillar", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const shortlist = one({ url: "https://images-assets.nasa.gov/a.jpg", source: "nasa" });

    const photo = await findLicensedPhoto(shortlist, {
      fetch,
      photoDir,
      clubPhotos: clubStore([consented]),
    });

    expect(photo?.url).toBe("https://images-assets.nasa.gov/a.jpg");
  });

  it("keeps going when the club photo store is broken", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const broken: PhotoStore = {
      listClubPhotos: async () => {
        throw new Error("the photo drop is offline");
      },
    };
    const shortlist = one({ url: "https://images-assets.nasa.gov/a.jpg", source: "nasa" }, "club");

    const photo = await findLicensedPhoto(shortlist, { fetch, photoDir, clubPhotos: broken });

    expect(photo?.url).toBe("https://images-assets.nasa.gov/a.jpg");
  });
});

describe("the licence whitelist", () => {
  const allowed = ["CC BY", "cc-by", "CC BY 4.0", "CC BY-SA 3.0", "CC0", "public domain", "NASA"];

  for (const license of allowed) {
    it(`accepts an image licensed "${license}"`, async () => {
      const fetch = fakeFetch([IMAGE_ROUTE]);
      const photo = await findLicensedPhoto(
        one({ url: "https://cdn.example.test/rocket.jpg", license, source: "launchlibrary" }),
        { fetch, photoDir },
      );

      expect(photo?.license).toBe(license);
      expect(photo?.source).toBe("launchlibrary");
    });
  }

  const rejected = ["CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "All rights reserved", "Unknown", "GPLv3"];

  for (const license of rejected) {
    it(`rejects an image licensed "${license}"`, async () => {
      const fetch = fakeFetch([IMAGE_ROUTE]);
      const photo = await findLicensedPhoto(
        one({ url: "https://cdn.example.test/rocket.jpg", license, source: "launchlibrary" }),
        { fetch, photoDir },
      );

      expect(photo).toBeUndefined();
      expect(fetch.calls).toHaveLength(0);
    });
  }

  it("accepts anything served from nasa.gov whatever the licence says", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({ url: "https://images-assets.nasa.gov/image/PIA12345/PIA12345~orig.jpg", source: "nasa" }),
      { fetch, photoDir },
    );

    expect(photo?.url).toContain("images-assets.nasa.gov");
    expect(photo?.license).toContain("NASA");
  });

  it("is not fooled by a host that merely ends in the same letters", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({ url: "https://notnasa.gov.example.test/a.jpg", source: "somewhere" }),
      { fetch, photoDir },
    );

    expect(photo).toBeUndefined();
  });
});

describe("SpaceX on Flickr", () => {
  it("accepts a Flickr image credited to SpaceX", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({
        url: "https://live.staticflickr.com/65535/12345_o.jpg",
        license: "CC BY-NC 2.0",
        credit: "SpaceX",
        source: "flickr",
      }),
      { fetch, photoDir },
    );

    expect(photo?.credit).toBe("SpaceX");
    expect(photo?.license).toBe("CC BY-NC 2.0");
  });

  it("accepts it when SpaceX is named in the source instead of the credit", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({ url: "https://www.flickr.com/photos/spacex/1_o.jpg", source: "SpaceX on Flickr" }),
      { fetch, photoDir },
    );

    expect(photo?.url).toContain("flickr.com");
  });

  it("rejects a Flickr image by anyone else", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({
        url: "https://live.staticflickr.com/65535/99999_o.jpg",
        license: "CC BY-NC 2.0",
        credit: "A photographer",
        source: "flickr",
      }),
      { fetch, photoDir },
    );

    expect(photo).toBeUndefined();
  });
});

/** Only the API call is routed here; the image bytes fall through to IMAGE_ROUTE. */
const commonsRoute = (fixture: string): Route => ({ match: "commons.wikimedia.org/w/api.php", fixture });

describe("Wikimedia Commons", () => {
  const upload = (name: string): Image => ({
    url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`,
    source: "wikimedia",
  });

  it("accepts a file Commons reports as CC0, and credits the artist", async () => {
    const fetch = fakeFetch([
      commonsRoute("commons-cc0.json"),
      IMAGE_ROUTE,
    ]);

    const photo = await findLicensedPhoto(
      one(upload("Falcon_Heavy_Demo_Mission_%2840126461851%29.jpg")),
      { fetch, photoDir },
    );

    expect(photo?.license).toBe("CC0");
    expect(photo?.credit).toBe("SpaceX");
    expect(fetch.calls[0]).toContain("commons.wikimedia.org/w/api.php");
    expect(fetch.calls[0]).toContain("prop=imageinfo");
    // The title asked about is the file name, not the thumbnail.
    expect(decodeURIComponent(fetch.calls[0] ?? "")).toContain(
      "File:Falcon_Heavy_Demo_Mission_(40126461851).jpg",
    );
  });

  it("accepts a file Commons reports as CC BY-SA", async () => {
    const fetch = fakeFetch([commonsRoute("commons-ccbysa.json"), IMAGE_ROUTE]);

    const photo = await findLicensedPhoto(one(upload("%21mpulse_Leeuwarden.jpg")), {
      fetch,
      photoDir,
    });

    expect(photo?.license).toBe("CC BY-SA 3.0");
    expect(photo?.credit).toContain("Wnauta");
  });

  it("looks up the file behind a thumbnail URL", async () => {
    const fetch = fakeFetch([commonsRoute("commons-cc0.json"), IMAGE_ROUTE]);

    const photo = await findLicensedPhoto(
      one({
        url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Falcon_Heavy_Demo_Mission.jpg/800px-Falcon_Heavy_Demo_Mission.jpg",
        source: "wikimedia",
      }),
      { fetch, photoDir },
    );

    expect(decodeURIComponent(fetch.calls[0] ?? "")).toContain(
      "File:Falcon_Heavy_Demo_Mission.jpg",
    );
    expect(photo?.license).toBe("CC0");
  });

  it("rejects a file Commons reports under a software licence", async () => {
    const fetch = fakeFetch([commonsRoute("commons-gplv3.json"), IMAGE_ROUTE]);

    const photo = await findLicensedPhoto(one(upload("Complicitygraph.png")), { fetch, photoDir });

    expect(photo).toBeUndefined();
  });

  it("rejects a file Commons has never heard of", async () => {
    const fetch = fakeFetch([commonsRoute("commons-missing.json"), IMAGE_ROUTE]);

    const photo = await findLicensedPhoto(one(upload("Anders_Zorn_-_Midsummer_Dance.jpg")), {
      fetch,
      photoDir,
    });

    expect(photo).toBeUndefined();
  });

  it("rejects the file rather than throwing when Commons is down", async () => {
    const fetch = fakeFetch([
      { match: "commons.wikimedia.org", throws: "connect ETIMEDOUT" },
      IMAGE_ROUTE,
    ]);

    const photo = await findLicensedPhoto(one(upload("Falcon_Heavy.jpg")), { fetch, photoDir });

    expect(photo).toBeUndefined();
  });
});

describe("order and download", () => {
  it("prefers the earlier rule even when the later match comes first in the shortlist", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const shortlist = listOf([
      [{ url: "https://live.staticflickr.com/1_o.jpg", credit: "SpaceX", source: "flickr" }],
      [{ url: "https://images-assets.nasa.gov/orion.jpg", source: "nasa" }],
    ]);

    const photo = await findLicensedPhoto(shortlist, { fetch, photoDir });

    expect(photo?.url).toBe("https://images-assets.nasa.gov/orion.jpg");
  });

  it("downloads the chosen image into photoDir, keeping the extension", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({ url: "https://images-assets.nasa.gov/orion.jpg?size=orig", source: "nasa" }),
      { fetch, photoDir },
    );

    expect(photo?.path).toBeDefined();
    expect(photo?.path.startsWith(photoDir)).toBe(true);
    expect(photo?.path.endsWith(".jpg")).toBe(true);
    expect(new Uint8Array(await readFile(photo?.path ?? ""))).toEqual(BYTES);
  });

  it("moves on to the next candidate when a download fails", async () => {
    const fetch = fakeFetch([
      { match: "broken.nasa.gov", status: 500, body: "nope" },
      IMAGE_ROUTE,
    ]);
    const shortlist = listOf([
      [{ url: "https://broken.nasa.gov/a.jpg", source: "nasa" }],
      [{ url: "https://images-assets.nasa.gov/b.jpg", source: "nasa" }],
    ]);

    const photo = await findLicensedPhoto(shortlist, { fetch, photoDir });

    expect(photo?.url).toBe("https://images-assets.nasa.gov/b.jpg");
  });

  it("returns nothing, and does not throw, when nothing qualifies", async () => {
    const fetch = fakeFetch([IMAGE_ROUTE]);
    const shortlist = listOf([
      [{ url: "https://news.example.test/photo.jpg", license: "All rights reserved", source: "press" }],
      [],
    ]);

    await expect(findLicensedPhoto(shortlist, { fetch, photoDir })).resolves.toBeUndefined();
  });

  it("returns nothing for an empty shortlist", async () => {
    const fetch = fakeFetch([]);
    const shortlist: Shortlist = { assignment: assignment("review"), items: [], notes: [] };

    expect(await findLicensedPhoto(shortlist, { fetch, photoDir })).toBeUndefined();
    expect(fetch.calls).toHaveLength(0);
  });
});

describe("the injected fetch", () => {
  it("is the only way out to the network", async () => {
    const fetch: Fetch = fakeFetch([IMAGE_ROUTE]);
    const photo = await findLicensedPhoto(
      one({ url: "https://images-assets.nasa.gov/a.jpg", source: "nasa" }),
      { fetch, photoDir },
    );

    expect(photo).toBeDefined();
  });
});
