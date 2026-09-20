/**
 * Rule 4: an image on upload.wikimedia.org has no licence in its URL, so ask
 * Wikimedia Commons what it is before using it.
 */
import type { Fetch } from "../newsroom/ports.js";
import { isAllowedLicense } from "./whitelist.js";

const API = "https://commons.wikimedia.org/w/api.php";

export type CommonsLicense = { license: string; credit: string };

type CommonsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        missing?: string;
        imageinfo?: { extmetadata?: Record<string, { value?: unknown }> }[];
      }
    >;
  };
};

/**
 * The File: title behind an upload URL, including the thumbnail form
 * `/commons/thumb/a/ab/Name.jpg/800px-Name.jpg`, whose file is the
 * second-to-last segment.
 */
export function fileTitle(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const segments = path.split("/").filter(Boolean);
  const index = segments.includes("thumb") ? segments.length - 2 : segments.length - 1;
  const name = segments[index];
  if (!name) return undefined;
  try {
    return `File:${decodeURIComponent(name)}`;
  } catch {
    return `File:${name}`;
  }
}

export function commonsQueryUrl(title: string): string {
  return `${API}?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=extmetadata&format=json`;
}

function metadataText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The licence Commons reports, but only when the club may use it. Undefined
 * for anything else — a file Commons has never heard of, a licence outside the
 * whitelist, or Commons being unreachable. This never throws: a photo the
 * newsroom cannot verify is simply not a photo it may use.
 */
export async function lookUpCommonsLicense(
  url: string,
  fetch: Fetch,
): Promise<CommonsLicense | undefined> {
  const title = fileTitle(url);
  if (!title) return undefined;

  let payload: CommonsResponse;
  try {
    const res = await fetch(commonsQueryUrl(title), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return undefined;
    payload = (await res.json()) as CommonsResponse;
  } catch {
    return undefined;
  }

  const pages = Object.values(payload.query?.pages ?? {});
  for (const page of pages) {
    if (page.missing !== undefined) continue;
    const extra = page.imageinfo?.[0]?.extmetadata;
    const license = metadataText(extra?.LicenseShortName?.value);
    if (!isAllowedLicense(license)) continue;
    return { license, credit: metadataText(extra?.Artist?.value) };
  }
  return undefined;
}
