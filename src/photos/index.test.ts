import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhotoStore } from "./index.js";

async function dirWith(consent: unknown, files: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "photos-"));
  await writeFile(join(dir, "consent.json"), JSON.stringify(consent));
  for (const f of files) await writeFile(join(dir, f), "jpegbytes");
  return dir;
}

describe("createPhotoStore", () => {
  it("returns only listed, consented photos that exist on disk", async () => {
    const dir = await dirWith(
      [
        { file: "a.jpg", consentedBy: "officer", credit: "Club" },
        { file: "missing.jpg", consentedBy: "officer" },
        { file: "b.jpg" }, // no consentedBy → not usable
      ],
      ["a.jpg", "b.jpg"],
    );
    const photos = await createPhotoStore(dir).listClubPhotos();
    expect(photos.map((p) => p.path.split("/").pop())).toEqual(["a.jpg"]);
    expect(photos[0]?.source).toBe("club");
    expect(photos[0]?.credit).toBe("Club");
  });

  it("returns nothing when there is no consent list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "photos-"));
    expect(await createPhotoStore(dir).listClubPhotos()).toEqual([]);
  });
});
