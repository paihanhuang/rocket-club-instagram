import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import type { LicensedPhoto } from "../newsroom/types.js";
import type { PhotoStore } from "../newsroom/ports.js";

type ConsentEntry = { file: string; credit?: string; students?: string[]; consentedBy?: string; on?: string };

/** Consented club photos: only files listed in consent.json and present on disk. */
export function createPhotoStore(dir: string): PhotoStore {
  return {
    async listClubPhotos(): Promise<LicensedPhoto[]> {
      let entries: ConsentEntry[];
      try {
        entries = JSON.parse(await readFile(join(dir, "consent.json"), "utf8")) as ConsentEntry[];
      } catch {
        return [];
      }
      const photos: LicensedPhoto[] = [];
      for (const e of Array.isArray(entries) ? entries : []) {
        if (!e || typeof e.file !== "string" || !e.consentedBy) continue;
        const path = join(dir, e.file);
        try {
          await access(path);
        } catch {
          continue;
        }
        photos.push({
          url: `file://${path}`,
          license: "club photo, consented",
          credit: e.credit ?? "LAHS Rocket Club",
          source: "club",
          path,
        });
      }
      // newest consent first
      return photos.sort((a, b) => (b.path > a.path ? 1 : -1));
    },
  };
}
