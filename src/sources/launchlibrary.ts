/**
 * Launch Library 2 (thespacedevs), upcoming launches.
 *
 * The free tier allows 15 requests an hour, so this source is read at most
 * once every six hours (see `ttlMs`) and one response covers both the launches
 * and the weekend pillar.
 *
 * `mode=detailed` is the smallest mode that carries everything mapped here:
 * `mode=list` has no pad and no mission, and `mode=normal` has both but no
 * `info_urls` (the public page) and no `vid_urls` (the webcast).
 */
import type { Item } from "../newsroom/types.js";
import { HOUR_MS, itemId, type ParseContext, type Source } from "./source.js";

export const LAUNCH_LIBRARY_SITE = "https://ll.thespacedevs.com";

const UPCOMING_URL = `${LAUNCH_LIBRARY_SITE}/2.3.0/launches/upcoming/?limit=40&mode=detailed`;

const SOURCE_NAME = "launchlibrary";

/**
 * Extras this source hangs off an Item. They are not part of the shared domain
 * type, so any module that does not know about them ignores them; the
 * shortlist reads them to rank launches. Kept optional and structural on
 * purpose: no module has to import this file to stay correct.
 */
export type LaunchExtras = {
  /** The vehicle's full name, e.g. "Falcon 9 Block 5" or "Starship V3". */
  vehicle?: string;
  /** The best webcast Launch Library knows about, if any. */
  webcast?: { url: string; title?: string; publisher?: string };
};

export type LaunchItem = Item & LaunchExtras;

type Named = { name?: string | null } | null | undefined;

type LaunchLibraryUrl = {
  url?: string | null;
  priority?: number | null;
  title?: string | null;
  publisher?: string | null;
  type?: Named;
};

type LaunchLibraryLaunch = {
  id?: string | null;
  name?: string | null;
  net?: string | null;
  window_start?: string | null;
  image?: {
    image_url?: string | null;
    credit?: string | null;
    license?: { name?: string | null; link?: string | null } | null;
  } | null;
  pad?: {
    name?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    location?: Named;
  } | null;
  mission?: { description?: string | null } | null;
  rocket?: { configuration?: { full_name?: string | null; name?: string | null } | null } | null;
  info_urls?: LaunchLibraryUrl[] | null;
  vid_urls?: LaunchLibraryUrl[] | null;
};

function isoOrUndefined(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function coordinate(raw: number | string | null | undefined): number | undefined {
  const value = typeof raw === "string" ? Number.parseFloat(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Launch Library orders these by `priority`, highest first; official webcasts win. */
function best(urls: LaunchLibraryUrl[] | null | undefined): LaunchLibraryUrl | undefined {
  const usable = (urls ?? []).filter((u) => typeof u.url === "string" && u.url.length > 0);
  if (usable.length === 0) return undefined;
  return usable.reduce((a, b) => ((b.priority ?? 0) > (a.priority ?? 0) ? b : a));
}

function toItem(launch: LaunchLibraryLaunch, ctx: ParseContext): LaunchItem | undefined {
  const id = launch.id;
  const title = launch.name?.trim();
  if (!id || !title) return undefined;

  const publicPage = best(launch.info_urls)?.url ?? undefined;
  const item: LaunchItem = {
    id: itemId(SOURCE_NAME, id),
    source: SOURCE_NAME,
    title,
    url: publicPage ?? LAUNCH_LIBRARY_SITE,
    summary: launch.mission?.description?.trim() ?? "",
    fetchedAt: ctx.fetchedAt,
  };

  // The launch window opening is when a viewer has to be watching; `net` is
  // the single target time inside it and is the fallback when there is no window.
  const startsAt = isoOrUndefined(launch.window_start) ?? isoOrUndefined(launch.net);
  if (startsAt) item.startsAt = startsAt;

  const pad = launch.pad;
  const lat = coordinate(pad?.latitude);
  const lon = coordinate(pad?.longitude);
  if (pad && lat !== undefined && lon !== undefined) {
    const parts = [pad.name, pad.location?.name].filter((p): p is string => Boolean(p));
    item.location = { name: parts.join(", "), lat, lon };
  }

  const image = launch.image;
  if (image?.image_url) {
    const candidate: NonNullable<Item["images"]>[number] & { licenseLink?: string } = {
      url: image.image_url,
      source: SOURCE_NAME,
    };
    // "Unknown" is Launch Library's placeholder, not a licence; saying nothing
    // is more honest than saying "Unknown" to the licence check.
    const license = image.license?.name?.trim();
    if (license && license.toLowerCase() !== "unknown") candidate.license = license;
    const link = image.license?.link?.trim();
    if (link) candidate.licenseLink = link;
    const credit = image.credit?.trim();
    if (credit) candidate.credit = credit;
    item.images = [candidate];
  }

  const vehicle = launch.rocket?.configuration?.full_name ?? launch.rocket?.configuration?.name;
  if (vehicle) item.vehicle = vehicle;

  const webcast = best(launch.vid_urls);
  if (webcast?.url) {
    const cast: NonNullable<LaunchExtras["webcast"]> = { url: webcast.url };
    if (webcast.title) cast.title = webcast.title;
    if (webcast.publisher) cast.publisher = webcast.publisher;
    item.webcast = cast;
  }

  return item;
}

export const launchLibraryUpcoming: Source = {
  name: SOURCE_NAME,
  url: UPCOMING_URL,
  // Six hours: four calls a day, well inside the 15-an-hour free tier even
  // when the launches and weekend pillars both run.
  ttlMs: 6 * HOUR_MS,
  parse(body: string, ctx: ParseContext): Item[] {
    const payload = JSON.parse(body) as { results?: LaunchLibraryLaunch[] | null };
    return (payload.results ?? [])
      .map((launch) => toItem(launch, ctx))
      .filter((item): item is LaunchItem => item !== undefined);
  },
};
