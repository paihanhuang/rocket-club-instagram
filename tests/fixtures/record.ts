/**
 * Records the source fixtures in this directory from the real services.
 *
 *   pnpm exec tsx tests/fixtures/record.ts
 *
 * Run by hand, rarely. Tests never hit the network; they replay what this
 * wrote. Launch Library allows 15 requests an hour, so this makes exactly one
 * Launch Library call, and asks for the smallest page that still carries every
 * field the sources module maps (window_start, pad latitude/longitude and
 * location name, image with its license and credit, mission description,
 * info_urls for the public page, vid_urls for the webcast).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** A polite agent string: these are public feeds read by a school club. */
const USER_AGENT = "lahsrocketry-newsroom/0.1 (+https://github.com/lahsrocketry)";

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return await res.text();
}

async function save(name: string, body: string): Promise<void> {
  await mkdir(here, { recursive: true });
  await writeFile(`${here}/${name}`, body, "utf8");
  console.log(`${name}  ${new Intl.NumberFormat("en-US").format(body.length)} bytes`);
}

/** Keeps the first `n` <item> elements of an RSS 2.0 document, verbatim. */
function trimFeed(xml: string, n: number): string {
  let cut = -1;
  let from = 0;
  for (let i = 0; i <= n; i++) {
    const at = xml.indexOf("<item>", from);
    if (at === -1) return xml;
    if (i === n) cut = at;
    from = at + 1;
  }
  if (cut === -1) return xml;
  return `${xml.slice(0, cut).trimEnd()}\n</channel>\n</rss>\n`;
}

const FEEDS: { name: string; url: string }[] = [
  { name: "rss-nasa.xml", url: "https://www.nasa.gov/news-release/feed/" },
  { name: "rss-spacenews.xml", url: "https://spacenews.com/feed/" },
  { name: "rss-nasaspaceflight.xml", url: "https://www.nasaspaceflight.com/feed/" },
];

/** One Commons response per license outcome the module has to tell apart. */
const COMMONS_FILES: { name: string; title: string }[] = [
  { name: "commons-cc0.json", title: "File:Falcon Heavy Demo Mission (40126461851).jpg" },
  { name: "commons-ccbysa.json", title: "File:!mpulse Leeuwarden.jpg" },
  { name: "commons-gplv3.json", title: "File:Complicitygraph.png" },
  { name: "commons-missing.json", title: "File:Anders Zorn - Midsummer Dance.jpg" },
];

function commonsUrl(title: string): string {
  return `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(
    title,
  )}&prop=imageinfo&iiprop=extmetadata&format=json`;
}

async function main(): Promise<void> {
  // One Launch Library request. 8 upcoming launches is enough variety: crewed
  // and uncrewed, with and without a webcast, pads on three continents.
  const ll = await get("https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=8&mode=detailed");
  await save("launchlibrary-upcoming.json", JSON.stringify(JSON.parse(ll)));

  for (const feed of FEEDS) {
    await save(feed.name, trimFeed(await get(feed.url), 6));
  }

  for (const file of COMMONS_FILES) {
    // Wikimedia rate-limits bursts; one a second is plenty polite.
    await new Promise((r) => setTimeout(r, 1000));
    const body = await get(commonsUrl(file.title));
    await save(file.name, JSON.stringify(JSON.parse(body), null, 1));
  }
}

await main();
