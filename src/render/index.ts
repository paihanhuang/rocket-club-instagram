/**
 * render — turns a `DraftText` into the JPEG slides a draft is reviewed and
 * published as.
 *
 * The interface is two functions. `renderHtml` is pure: same arguments, same
 * string, no browser, which is what the tests and the preview page assert on.
 * `renderSlides` is the only part that needs Chromium, and it does nothing but
 * screenshot what `renderHtml` produced.
 *
 * What the seam hides: the card templates, the cover/middle/closing rules, the
 * text-fitting classes, photo embedding, and Instagram's image constraints
 * (JPEG only, 1080x1350 inside the 4:5 to 1.91:1 range, width within 320-1440,
 * sRGB, well under the 8 MB ceiling).
 */
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import type { DraftText, LicensedPhoto, Pillar, Slide } from "../newsroom/types.js";

/** 4:5, the tallest portrait Instagram accepts, and inside the 320-1440 width range. */
export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
/** Instagram's ceiling is 8 MB; a card this flat lands an order of magnitude below it. */
export const JPEG_QUALITY = 90;
export const DEFAULT_HANDLE = "@lahsrocketry";

/** Past these lengths the type steps down a size so the text still fits the card. */
const HEADLINE_SHRINK_OVER = 40;
const BODY_SHRINK_OVER = 180;

export type RenderOptions = {
  /** Reuse a browser across drafts. When absent, one is launched and closed here. */
  browser?: Browser;
  /** Defaults to `@lahsrocketry`. */
  handle?: string;
};

/**
 * Renders every slide of `text` into `outDir` as `slide-01.jpg`, `slide-02.jpg`, ...
 * Returns them in order. Existing files with the same names are overwritten.
 */
export async function renderSlides(
  text: DraftText,
  pillar: Pillar,
  photo: LicensedPhoto | undefined,
  outDir: string,
  opts: RenderOptions = {},
): Promise<Slide[]> {
  const count = planSlides(text).length;
  await mkdir(outDir, { recursive: true });

  const browser = opts.browser ?? (await chromium.launch());
  const ownsBrowser = opts.browser === undefined;
  try {
    const context = await browser.newContext({
      viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    try {
      const page = await context.newPage();
      await page.setViewportSize({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT });

      const slides: Slide[] = [];
      for (let i = 0; i < count; i++) {
        const file = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
        // `load` so an embedded photo is decoded before the shutter.
        await page.setContent(renderHtml(text, pillar, photo, i, opts.handle), { waitUntil: "load" });
        await page.screenshot({ path: file, type: "jpeg", quality: JPEG_QUALITY });
        slides.push({ path: file, width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
      }
      return slides;
    } finally {
      await context.close();
    }
  } finally {
    if (ownsBrowser) await browser.close();
  }
}

/**
 * The HTML for one slide, `slideIndex` counted from 0. Pure: no network, no
 * writes, and the only reads are the templates, which do not change at runtime.
 * Every string that came from the model is escaped.
 */
export function renderHtml(
  text: DraftText,
  pillar: Pillar,
  photo: LicensedPhoto | undefined,
  slideIndex: number,
  handle: string = DEFAULT_HANDLE,
): string {
  const plan = planSlides(text);
  const slide = plan[slideIndex];
  if (!slide) {
    throw new RangeError(`renderHtml: slide ${slideIndex} is outside this draft's ${plan.length} slides`);
  }

  const at = normaliseHandle(handle);
  const photoUri = slide.kind === "cover" && photo ? dataUri(photo.path) : undefined;
  const footer = `<footer class="footer"><span class="handle">${esc(at)}</span><span class="count">${
    slideIndex + 1
  } / ${plan.length}</span></footer>`;

  let modifiers = "";
  let body: string;
  if (slide.kind === "cover") {
    modifiers = photoUri ? ` cover has-photo${photoFit(text.headline, slide.body)}` : " cover";
    body = [
      photoUri ? `<div class="photo" style="background-image:url(${photoUri})"></div>` : "",
      photoUri && photo ? `<div class="credit">Photo: ${esc(photo.credit)}</div>` : "",
      brand(pillar),
      `<section class="content">`,
      photoUri ? "" : `<div class="rule"></div>`,
      headline(text.headline),
      paragraph(slide.body),
      `</section>`,
      footer,
    ].join("\n");
  } else if (slide.kind === "middle") {
    modifiers = " middle";
    body = [
      brand(pillar),
      `<section class="content">`,
      `<div class="rule"></div>`,
      headline(slide.title),
      paragraph(slide.body),
      `</section>`,
      footer,
    ].join("\n");
  } else {
    modifiers = " closing";
    body = [
      brand(pillar),
      `<section class="content">`,
      `<div class="eyebrow">Next step</div>`,
      headline(slide.title),
      paragraph(slide.body),
      `<div class="sign"><div class="bar"></div><div class="handle-big">${esc(at)}</div></div>`,
      `</section>`,
      footer,
    ].join("\n");
  }

  const card = fill(fill(template(`${pillar}.html`), "MODIFIERS", modifiers), "CONTENT", body);
  const shell = fill(template("card.html"), "TITLE", esc(text.headline));
  return fill(fill(shell, "CSS", template("base.css")), "CARD", card);
}

/* ------------------------------------------------------------------------ */

type SlidePlan =
  | { kind: "cover"; body: string }
  | { kind: "middle"; title: string; body: string }
  | { kind: "closing"; title: string; body: string };

/**
 * The deck a `DraftText` becomes: a cover carrying the headline and the first
 * entry's body as its subtitle, the entries in between as their own slides, and
 * the last entry as the closing next step. A single entry still makes two
 * slides, because a carousel of one is just a photo.
 */
function planSlides(text: DraftText): SlidePlan[] {
  const entries = text.slides;
  const first = entries[0];
  const last = entries[entries.length - 1];
  if (!first || !last) throw new Error("render: a draft needs at least one slide entry");

  const plan: SlidePlan[] = [{ kind: "cover", body: first.body }];
  for (const entry of entries.slice(1, -1)) {
    plan.push({ kind: "middle", title: entry.title, body: entry.body });
  }
  plan.push({ kind: "closing", title: last.title, body: last.body });
  return plan;
}

/**
 * Substitutes every `{{KEY}}` in a template. The replacement goes in through a
 * function so that a `$&` or `$'` in model text is inserted literally instead
 * of being read as a replacement pattern.
 */
function fill(template_: string, key: string, value: string): string {
  const placeholder = `{{${key}}}`;
  if (!template_.includes(placeholder)) {
    throw new Error(`render: template is missing the ${placeholder} placeholder`);
  }
  return template_.split(placeholder).join(value);
}

function brand(pillar: Pillar): string {
  return `<header class="brand"><span class="mark">${template("logo.svg")}</span><span class="tag">${esc(
    pillar,
  )}</span></header>`;
}

/**
 * How much of the cover the photo may keep. Long cover text needs the room,
 * and a photo cropped a little shorter beats a headline in the footer.
 */
function photoFit(headlineText: string, bodyText: string): string {
  const longHeadline = headlineText.length > HEADLINE_SHRINK_OVER;
  const longBody = bodyText.length > BODY_SHRINK_OVER;
  if (longHeadline && longBody) return " cover-tighter";
  return longHeadline || longBody ? " cover-tight" : "";
}

function headline(value: string): string {
  const klass = value.length > HEADLINE_SHRINK_OVER ? "headline is-small" : "headline";
  return `<h1 class="${klass}">${esc(value)}</h1>`;
}

function paragraph(value: string): string {
  const klass = value.length > BODY_SHRINK_OVER ? "body is-small" : "body";
  return `<p class="${klass}">${esc(value)}</p>`;
}

function normaliseHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

/** Nothing the model wrote reaches the page as markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Photos are local files, so they go in as base64. A `file://` URL would work
 * for a page that was loaded from disk, but `setContent` gives the page an
 * about:blank origin, and a data URI has no such problem.
 */
function dataUri(file: string): string | undefined {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch {
    return undefined; // no usable photo: the cover falls back to type alone
  }
  return `data:${imageType(buf, file)};base64,${buf.toString("base64")}`;
}

function imageType(buf: Buffer, file: string): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const ext = path.extname(file).toLowerCase();
  return ext === ".png" ? "image/png" : "image/jpeg";
}

const cache = new Map<string, string>();

/** Reads a file from `templates/`, once. */
function template(name: string): string {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  const text = readFileSync(path.join(templatesDir(), name), "utf8");
  cache.set(name, text);
  return text;
}

let templatesRoot: string | undefined;

/**
 * Finds `templates/` by walking up from this module, so the same code works
 * run from source, from `dist/`, and from a test with any cwd.
 */
function templatesDir(): string {
  if (templatesRoot) return templatesRoot;
  const fromEnv = process.env["TEMPLATES_DIR"];
  if (fromEnv) return (templatesRoot = path.resolve(fromEnv));

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, "templates");
    try {
      readFileSync(path.join(candidate, "base.css"));
      return (templatesRoot = candidate);
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("render: could not find the templates/ directory");
}
