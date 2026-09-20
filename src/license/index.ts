/**
 * license: `findLicensedPhoto(shortlist, opts)` — a photo the club is allowed
 * to post, downloaded and ready for the card, or nothing.
 *
 * Behind the seam: the whitelist rules in order, the Wikimedia Commons licence
 * lookup, and the download. The rules are a whitelist on purpose: this is a
 * school-affiliated account, so an image is used only when something says it
 * may be, never because nothing said it may not.
 *
 * Nothing here throws for a rejected or broken image. "No licensed photo" is a
 * normal outcome; the draft carries a flag instead of a picture.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Fetch, PhotoStore } from "../newsroom/ports.js";
import type { LicensedPhoto, Shortlist } from "../newsroom/types.js";
import { lookUpCommonsLicense } from "./commons.js";
import {
  allowedAsSpaceXFlickr,
  allowedByLicenseOrHost,
  type CandidateImage,
  isWikimediaUpload,
} from "./whitelist.js";

export type FindLicensedPhotoOptions = {
  fetch: Fetch;
  /** Where the chosen photo is written. Created if it does not exist. */
  photoDir: string;
  /** Only consulted for the club pillar. */
  clubPhotos?: PhotoStore;
};

const EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
]);

const KNOWN_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);

/** The URL's own extension when it looks like an image, else the served type. */
function extensionFor(url: string, contentType: string | null): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
    const dot = last.lastIndexOf(".");
    const fromUrl = dot === -1 ? "" : last.slice(dot).toLowerCase();
    if (KNOWN_EXTENSIONS.has(fromUrl)) return fromUrl;
  } catch {
    // Fall through to the content type.
  }
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return EXTENSIONS.get(type) ?? ".jpg";
}

/** Deterministic, so the same photo lands in the same file every run. */
function fileNameFor(url: string, extension: string): string {
  return `${createHash("sha256").update(url).digest("hex").slice(0, 16)}${extension}`;
}

/** Undefined when the image cannot be downloaded; the caller tries the next one. */
async function download(
  image: CandidateImage,
  license: string,
  credit: string,
  opts: FindLicensedPhotoOptions,
): Promise<LicensedPhoto | undefined> {
  try {
    const res = await opts.fetch(image.url, { headers: { accept: "image/*" } });
    if (!res.ok) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0) return undefined;

    const path = join(
      opts.photoDir,
      fileNameFor(image.url, extensionFor(image.url, res.headers.get("content-type"))),
    );
    await mkdir(opts.photoDir, { recursive: true });
    await writeFile(path, bytes);
    return { url: image.url, license, credit, source: image.source, path };
  } catch {
    return undefined;
  }
}

/** Rule 1: the club's own photos are consented already, so they need no check. */
async function clubPhoto(
  shortlist: Shortlist,
  opts: FindLicensedPhotoOptions,
): Promise<LicensedPhoto | undefined> {
  if (shortlist.assignment.pillar !== "club" || !opts.clubPhotos) return undefined;
  try {
    return (await opts.clubPhotos.listClubPhotos())[0];
  } catch {
    return undefined;
  }
}

export async function findLicensedPhoto(
  shortlist: Shortlist,
  opts: FindLicensedPhotoOptions,
): Promise<LicensedPhoto | undefined> {
  const club = await clubPhoto(shortlist, opts);
  if (club) return club;

  const images: CandidateImage[] = shortlist.items.flatMap((item) => item.images ?? []);

  // Rule 2, then rule 3: whole-list passes, so a rule always beats a later one
  // no matter where in the shortlist its image sits.
  for (const rule of [allowedByLicenseOrHost, allowedAsSpaceXFlickr]) {
    for (const image of images) {
      const license = rule(image);
      if (!license) continue;
      const photo = await download(image, license, image.credit ?? "", opts);
      if (photo) return photo;
    }
  }

  // Rule 4: Wikimedia says what the licence is, one request per candidate.
  for (const image of images) {
    if (!isWikimediaUpload(image.url)) continue;
    const verdict = await lookUpCommonsLicense(image.url, opts.fetch);
    if (!verdict) continue;
    const photo = await download(image, verdict.license, image.credit ?? verdict.credit, opts);
    if (photo) return photo;
  }

  return undefined;
}
