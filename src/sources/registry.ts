/**
 * The source registry: which sources a pillar is made of.
 *
 * Nothing here knows about the network or the disk cache; `index.ts` owns
 * both, so adding a source is a one-line change here.
 */
import type { Pillar } from "../newsroom/types.js";
import { launchLibraryUpcoming } from "./launchlibrary.js";
import { rssFeed } from "./rss.js";
import type { Source } from "./source.js";

/** The feeds the Sunday review is written from. NASA first; the shortlist prefers it on ties. */
const REVIEW_FEEDS: Source[] = [
  rssFeed("nasa", "https://www.nasa.gov/news-release/feed/"),
  rssFeed("spacenews", "https://spacenews.com/feed/"),
  rssFeed("nasaspaceflight", "https://www.nasaspaceflight.com/feed/"),
];

export const REGISTRY: Record<Pillar, readonly Source[]> = {
  launches: [launchLibraryUpcoming],
  // The weekend pillar asks the same question of the same source, then filters
  // it down to what can be seen from the Bay Area.
  weekend: [launchLibraryUpcoming],
  review: REVIEW_FEEDS,
  // The explainer and the club post are written from the club's own material,
  // not fetched. An empty list is the honest answer, not a missing case.
  explainer: [],
  club: [],
  // TODO(week two): wire the opportunities sources (NASA internships, student
  // launch competitions, local scholarships) and the neighbors sources (Ames,
  // SETI, Chabot, Bay Area college rocketry teams). Until then these pillars
  // are written from the angle in the assignment alone.
  opportunities: [],
  neighbors: [],
};

export function sourcesFor(pillar: Pillar): readonly Source[] {
  return REGISTRY[pillar];
}
