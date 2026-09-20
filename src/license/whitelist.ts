/**
 * The whitelist rules, as pure predicates over one candidate image.
 *
 * The club account is school-affiliated, so the rule is "prove it is allowed",
 * never "assume it is fine". Everything that is not recognised is rejected.
 */

/** What a source offers the licence check. Matches `Item["images"][number]`. */
export type CandidateImage = {
  url: string;
  license?: string | undefined;
  credit?: string | undefined;
  source: string;
};

/** Said of anything NASA publishes: its media are generally not copyrighted. */
export const NASA_MEDIA_LICENSE = "NASA media usage guidelines (public domain)";

/** Hosts whose own terms are the licence. */
const NASA_HOSTS = ["nasa.gov"];
/** ESA publishes most imagery CC BY-SA 3.0 IGO and states the licence per image. */
const ESA_HOSTS = ["esa.int"];
/** The one source whose licence tags are curated by a third party we trust. Matches sources/launchlibrary.ts. */
export const LAUNCH_LIBRARY_SOURCE = "launchlibrary";
/** Flickr serves its originals off staticflickr.com, so both count as Flickr. */
const FLICKR_HOSTS = ["flickr.com", "staticflickr.com"];
const WIKIMEDIA_UPLOAD_HOST = "upload.wikimedia.org";

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** True suffix matching: `evil-nasa.gov.example.test` is not NASA. */
function hostIsUnder(url: string, domains: readonly string[]): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

export const isNasaHosted = (url: string): boolean => hostIsUnder(url, NASA_HOSTS);
export const isEsaHosted = (url: string): boolean => hostIsUnder(url, ESA_HOSTS);
export const isFlickrHosted = (url: string): boolean => hostIsUnder(url, FLICKR_HOSTS);
export const isWikimediaUpload = (url: string): boolean =>
  hostOf(url) === WIKIMEDIA_UPLOAD_HOST;

/**
 * The Creative Commons clauses in a licence name, e.g. "CC BY-NC-SA 4.0" →
 * ["by","nc","sa"], "CC-BY" → ["by"], "CC0 1.0" → ["zero"]. Undefined when the
 * string is not a Creative Commons licence at all.
 */
function ccClauses(license: string): string[] | undefined {
  const text = license.toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  if (/^cc[\s-]*(0|zero)\b/.test(text)) return ["zero"];
  const match = /^cc[\s-]+((?:by|nc|nd|sa)(?:[\s-]+(?:by|nc|nd|sa))*)\b/.exec(text);
  if (!match?.[1]) return undefined;
  return match[1].split(/[\s-]+/).filter(Boolean);
}

/**
 * The licences a school club may reuse: CC BY, CC BY-SA, CC0, public domain,
 * and NASA's own terms. Non-commercial (NC) and no-derivatives (ND) are
 * rejected here — the account posts rendered cards, which are derivatives, and
 * a school account is not reliably non-commercial. SpaceX's CC BY-NC photos
 * come in through the Flickr rule instead, which is a deliberate exception.
 */
export function isAllowedLicense(license: string | undefined): boolean {
  if (!license) return false;
  const text = license.toLowerCase().trim();

  const clauses = ccClauses(text);
  if (clauses) {
    if (clauses[0] === "zero") return true;
    return clauses.includes("by") && clauses.every((c) => c === "by" || c === "sa");
  }

  if (text.startsWith("public domain") || text.startsWith("pd-")) return true;
  if (text.startsWith("nasa")) return true;
  return false;
}

/**
 * Rule 2: NASA by its own terms; otherwise a reusable licence, but only when
 * the tag comes from a source the fence names (Launch Library's curated
 * metadata, or ESA's own site). A licence tag on an image from an unknown feed
 * proves nothing, and the fence says "nothing else, no matter how good it looks".
 */
export function allowedByLicenseOrHost(image: CandidateImage): string | undefined {
  // `||`, not `??`: an image that states an empty licence still needs a name here.
  if (isNasaHosted(image.url)) return image.license || NASA_MEDIA_LICENSE;
  const trustedTag = image.source === LAUNCH_LIBRARY_SOURCE || isEsaHosted(image.url);
  if (trustedTag && isAllowedLicense(image.license)) return image.license;
  return undefined;
}

/**
 * Rule 3: SpaceX on Flickr. SpaceX licenses its Flickr photostream CC BY-NC
 * 2.0, which a school club may use; nobody else's Flickr photos qualify.
 */
export function allowedAsSpaceXFlickr(image: CandidateImage): string | undefined {
  if (!isFlickrHosted(image.url)) return undefined;
  const attribution = `${image.credit ?? ""} ${image.source}`.toLowerCase();
  if (!attribution.includes("spacex")) return undefined;
  return image.license || "CC BY-NC 2.0 (SpaceX on Flickr)";
}
