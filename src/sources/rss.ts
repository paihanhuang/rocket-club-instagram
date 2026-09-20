/**
 * RSS 2.0 feeds. The three review sources (NASA, SpaceNews, NASASpaceflight)
 * are all WordPress feeds with the same shape: `<item>` with `<title>`,
 * `<link>`, `<pubDate>` and a `<description>` of escaped HTML.
 *
 * The parser is deliberately small rather than a full XML stack: it reads the
 * five elements the newsroom uses and ignores everything else. The recorded
 * fixtures are what keep it honest.
 */
import type { Item } from "../newsroom/types.js";
import { HOUR_MS, itemId, type ParseContext, type Source } from "./source.js";

/** Long enough to keep the writer's summary readable, short enough for a card. */
const SUMMARY_LIMIT = 400;

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** CDATA out, markup out, entities decoded, whitespace collapsed. */
function plainText(raw: string | undefined): string {
  if (raw === undefined) return "";
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  const withoutMarkup = withoutCdata.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutMarkup).replace(/\s+/g, " ").trim();
}

function element(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i");
  return re.exec(block)?.[1];
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function toItem(block: string, source: string, ctx: ParseContext): Item | undefined {
  const title = plainText(element(block, "title"));
  const url = plainText(element(block, "link")) || plainText(element(block, "guid"));
  if (!title || !url.startsWith("http")) return undefined;

  const item: Item = {
    id: itemId(source, url),
    source,
    title,
    url,
    summary: truncate(plainText(element(block, "description")), SUMMARY_LIMIT),
    fetchedAt: ctx.fetchedAt,
  };

  const stamp = plainText(element(block, "pubDate")) || plainText(element(block, "dc:date"));
  const publishedAt = stamp ? new Date(stamp) : undefined;
  if (publishedAt && !Number.isNaN(publishedAt.getTime())) {
    item.publishedAt = publishedAt.toISOString();
  }

  return item;
}

/** These feeds carry no image elements, so review items reach the licence check without photos. */
export function rssFeed(name: string, url: string): Source {
  return {
    name,
    url,
    // News moves slower than the two hours between a newsroom's runs.
    ttlMs: 2 * HOUR_MS,
    parse(body: string, ctx: ParseContext): Item[] {
      const items: Item[] = [];
      for (const match of body.matchAll(ITEM_RE)) {
        const block = match[1];
        if (block === undefined) continue;
        const item = toItem(block, name, ctx);
        if (item) items.push(item);
      }
      return items;
    },
  };
}
