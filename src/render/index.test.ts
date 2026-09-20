/**
 * Render tests. Everything goes through the module's interface: `renderHtml`
 * (pure, so it can be asserted on directly) and `renderSlides` (real Chromium,
 * checked by parsing the JPEG it wrote).
 *
 * One browser is launched for the whole file and handed to `renderSlides`;
 * one test deliberately omits it to cover the launch-and-close path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PILLARS, type DraftText, type LicensedPhoto } from "../newsroom/types.js";
import { renderHtml, renderSlides, SLIDE_HEIGHT, SLIDE_WIDTH } from "./index.js";
import { SAMPLES } from "./fixtures/samples.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_DIR = path.resolve(HERE, "../../out/preview");
/** Instagram's own ceiling is 8 MB; we hold ourselves to 1 MB per slide. */
const MAX_SLIDE_BYTES = 1024 * 1024;

let browser!: Browser;
let work!: string;
/** A synthetic "licensed photo": a real JPEG, made with the same browser. */
let photo!: LicensedPhoto;

beforeAll(async () => {
  browser = await chromium.launch();
  work = await mkdtemp(path.join(tmpdir(), "lahs-render-"));
  await mkdir(PREVIEW_DIR, { recursive: true });
  photo = await makePhotoFixture(browser, path.join(work, "plume.jpg"));
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (work) await rm(work, { recursive: true, force: true });
});

describe("renderHtml", () => {
  it("is pure: the same arguments give the same string", () => {
    const a = renderHtml(SAMPLES.launches, "launches", undefined, 0);
    const b = renderHtml(SAMPLES.launches, "launches", undefined, 0);
    expect(a).toBe(b);
    expect(a).toContain("Starship flies again Tuesday night");
  });

  it("escapes model output so a draft cannot inject markup", () => {
    const nasty: DraftText = {
      ...SAMPLES.launches,
      headline: '<script>alert("xss")</script> & <b>bold</b>',
      slides: [
        { title: "</style><script>window.x=1</script>", body: "5 > 3 && 2 < 4, said the \"model\"" },
        { title: "second", body: "<img src=x onerror=alert(1)>" },
      ],
    };
    const cover = renderHtml(nasty, "launches", undefined, 0);
    const closing = renderHtml(nasty, "launches", undefined, 1);
    for (const html of [cover, closing]) {
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("</style><script>");
    }
    expect(cover).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
    expect(cover).toContain("5 &gt; 3 &amp;&amp; 2 &lt; 4");
  });

  it("shrinks a long headline and a long body with a class, not a new size", () => {
    const short = renderHtml(SAMPLES.club, "club", undefined, 0); // 27 char headline
    const long = renderHtml(SAMPLES.opportunities, "opportunities", undefined, 0); // 42 chars
    expect(short).toContain('class="headline"');
    expect(long).toContain('class="headline is-small"');

    const longBody = "x".repeat(181);
    const wordy: DraftText = { ...SAMPLES.club, slides: [{ title: "t", body: longBody }] };
    expect(renderHtml(wordy, "club", undefined, 0)).toContain('class="body is-small"');
  });

  it("puts the handle in a footer on every slide and the source line on none", () => {
    const text = SAMPLES.weekend;
    for (let i = 0; i < text.slides.length; i++) {
      const html = renderHtml(text, "weekend", undefined, i, "@lahsrocketry");
      expect(html).toContain("@lahsrocketry");
      expect(html).toContain('class="footer"');
      expect(html).not.toContain(text.sourceLine);
      expect(html).not.toContain("Source:");
    }
  });

  it("uses the pillar's own template and accent class", () => {
    for (const pillar of PILLARS) {
      const html = renderHtml(SAMPLES[pillar], pillar, undefined, 0);
      expect(html).toContain(`pillar-${pillar}`);
    }
  });

  it("puts the photo and its credit on the cover only", () => {
    const withPhoto = renderHtml(SAMPLES.launches, "launches", photo, 0);
    expect(withPhoto).toContain('class="card pillar-launches cover has-photo"');
    expect(withPhoto).toContain('<div class="photo"');
    expect(withPhoto).toContain("data:image/jpeg;base64,");
    expect(withPhoto).toContain(`Photo: ${photo.credit}`);

    const middle = renderHtml(SAMPLES.launches, "launches", photo, 1);
    expect(middle).toContain('class="card pillar-launches middle"');
    expect(middle).not.toContain('<div class="photo"');
    expect(middle).not.toContain("base64,");
    expect(middle).not.toContain("Photo:");
  });

  it("leaves no placeholder behind, even when the text contains $& or $'", () => {
    const dollars: DraftText = {
      ...SAMPLES.weekend,
      headline: "Entry is $5 & $& a hot dog",
      slides: [{ title: "$'", body: "Bring $20 $& $` and a hat" }],
    };
    for (let i = 0; i < 2; i++) {
      const html = renderHtml(dollars, "weekend", undefined, i);
      expect(html).not.toContain("{{");
      expect(html).toContain("$&amp;");
    }
  });

  it("rejects a slide index outside the deck", () => {
    expect(() => renderHtml(SAMPLES.launches, "launches", undefined, 4)).toThrow(/slide/i);
    expect(() => renderHtml(SAMPLES.launches, "launches", undefined, -1)).toThrow(/slide/i);
  });
});

describe("renderSlides", () => {
  it(
    "writes one 1080x1350 JPEG per slide for a four slide draft",
    async () => {
      const outDir = path.join(work, "launches");
      const started = performance.now();
      const slides = await renderSlides(SAMPLES.launches, "launches", undefined, outDir, { browser });
      const perSlide = (performance.now() - started) / slides.length;

      expect(slides).toHaveLength(4);
      const sizes: number[] = [];
      for (const [i, slide] of slides.entries()) {
        expect(slide.path).toBe(path.join(outDir, `slide-0${i + 1}.jpg`));
        expect(slide.width).toBe(SLIDE_WIDTH);
        expect(slide.height).toBe(SLIDE_HEIGHT);

        const buf = await readFile(slide.path);
        expect([buf[0], buf[1], buf[2]]).toEqual([0xff, 0xd8, 0xff]); // JPEG magic
        expect(jpegSize(buf)).toEqual({ width: 1080, height: 1350 });
        expect((await stat(slide.path)).size).toBeLessThan(MAX_SLIDE_BYTES);
        sizes.push(buf.length);
      }
      // eslint-disable-next-line no-console
      console.log(
        `[render] 4 slides, ${Math.round(perSlide)} ms/slide, sizes ${sizes
          .map((b) => `${Math.round(b / 1024)} KB`)
          .join(", ")}`,
      );
    },
    120_000,
  );

  it(
    "renders a cover plus a closing slide when the draft has a single entry",
    async () => {
      const single: DraftText = { ...SAMPLES.club, slides: [SAMPLES.club.slides[0]!] };
      const outDir = path.join(work, "single");
      const slides = await renderSlides(single, "club", undefined, outDir, { browser });
      expect(slides.map((s) => path.basename(s.path))).toEqual(["slide-01.jpg", "slide-02.jpg"]);
      for (const s of slides) expect(jpegSize(await readFile(s.path))).toEqual({ width: 1080, height: 1350 });
    },
    120_000,
  );

  it(
    "renders a cover with a licensed photo",
    async () => {
      const outDir = path.join(work, "photo");
      const slides = await renderSlides(SAMPLES.launches, "launches", photo, outDir, { browser });
      expect(slides).toHaveLength(4);

      const cover = await readFile(slides[0]!.path);
      expect([cover[0], cover[1], cover[2]]).toEqual([0xff, 0xd8, 0xff]);
      expect(jpegSize(cover)).toEqual({ width: 1080, height: 1350 });
      expect(cover.length).toBeLessThan(MAX_SLIDE_BYTES);

      // The photo has to change the cover; a silently dropped photo would not.
      const plain = await renderSlides(SAMPLES.launches, "launches", undefined, path.join(work, "photo-none"), {
        browser,
      });
      expect(cover.length).not.toBe((await readFile(plain[0]!.path)).length);

      // Keep this one where a human can look at it too.
      await copyFile(slides[0]!.path, path.join(PREVIEW_DIR, "launches-cover-photo.jpg"));
    },
    120_000,
  );

  it(
    "launches and closes its own browser when none is given",
    async () => {
      const outDir = path.join(work, "own-browser");
      const slides = await renderSlides(SAMPLES.explainer, "explainer", undefined, outDir);
      expect(slides).toHaveLength(4);
      expect(jpegSize(await readFile(slides[0]!.path))).toEqual({ width: 1080, height: 1350 });
    },
    120_000,
  );

  it(
    "fits the longest text the writer schema allows without colliding",
    async () => {
      // 90 character headline, 60 character titles, 320 character bodies: the
      // schema's maximums. Nothing may touch the masthead or the footer.
      const longest = "This body is three hundred and twenty characters long, which is the longest the writer schema allows, and it has to fit on the card without touching the footer or spilling off the bottom edge, because Instagram crops nothing and a clipped sentence on a slide is the sort of thing an approver rejects on sight.";
      const entry = { title: "A sixty character slide title about propellant margins ok", body: longest };
      const stress: DraftText = {
        ...SAMPLES.club,
        headline: "A ninety character headline about a rocket launch window that slips again and again again",
        slides: [entry, entry, entry],
      };

      const page = await browser.newPage();
      await page.setViewportSize({ width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
      const cases: { html: string; label: string }[] = [
        { html: renderHtml(stress, "club", undefined, 0), label: "cover" },
        { html: renderHtml(stress, "club", undefined, 1), label: "middle" },
        { html: renderHtml(stress, "club", undefined, 2), label: "closing" },
        { html: renderHtml(stress, "club", photo, 0), label: "photo cover" },
      ];
      for (const { html, label } of cases) {
        await page.setContent(html, { waitUntil: "load" });
        const box = await page.evaluate(() => {
          const content = document.querySelector(".content")!;
          const first = content.firstElementChild!.getBoundingClientRect();
          const last = content.lastElementChild!.getBoundingClientRect();
          return {
            top: first.top,
            bottom: last.bottom,
            brandBottom: document.querySelector(".brand")!.getBoundingClientRect().bottom,
            footerTop: document.querySelector(".footer")!.getBoundingClientRect().top,
          };
        });
        expect(box.top, `${label}: text rides up into the masthead`).toBeGreaterThanOrEqual(box.brandBottom);
        expect(box.bottom, `${label}: text spills into the footer`).toBeLessThanOrEqual(box.footerTop);
      }
      await page.close();
    },
    120_000,
  );

  it(
    "renders every pillar's cover into out/preview for a human to look at",
    async () => {
      const written: string[] = [];
      for (const pillar of PILLARS) {
        const dir = path.join(work, `preview-${pillar}`);
        const slides = await renderSlides(SAMPLES[pillar], pillar, undefined, dir, { browser });
        const dest = path.join(PREVIEW_DIR, `${pillar}-cover.jpg`);
        await copyFile(slides[0]!.path, dest);
        written.push(dest);

        const buf = await readFile(dest);
        expect(jpegSize(buf)).toEqual({ width: 1080, height: 1350 });
        expect(buf.length).toBeLessThan(MAX_SLIDE_BYTES);
      }
      expect(written).toHaveLength(7);

      // One deck in full, so the middle and closing designs can be looked at too.
      const deck = path.join(PREVIEW_DIR, "explainer-deck");
      await mkdir(deck, { recursive: true });
      const full = await renderSlides(SAMPLES.explainer, "explainer", undefined, deck, { browser });
      expect(full).toHaveLength(4);

      // eslint-disable-next-line no-console
      console.log(`[render] previews:\n${[...written, ...full.map((s) => s.path)].join("\n")}`);
    },
    180_000,
  );
});

/** A believable stand-in for a licensed photo: a real JPEG, 1600x1200. */
async function makePhotoFixture(b: Browser, file: string): Promise<LicensedPhoto> {
  const page = await b.newPage();
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.setContent(
    `<body style="margin:0">
       <div style="width:1600px;height:1200px;
         background:
           radial-gradient(circle at 48% 86%, #FFF6D8 0%, #FFB24D 9%, rgba(255,120,26,.65) 18%, rgba(255,80,20,0) 34%),
           linear-gradient(to bottom, #0B1220 0%, #24324B 42%, #6B4A5C 72%, #C86B3C 100%);"></div>
     </body>`,
    { waitUntil: "load" },
  );
  await page.screenshot({ path: file, type: "jpeg", quality: 85 });
  await page.close();
  return {
    url: "https://images.nasa.gov/details/fixture",
    license: "NASA public domain",
    credit: "NASA/Joel Kowsky",
    source: "nasa",
    path: file,
  };
}

/**
 * Reads width and height out of a JPEG's frame header. Walks the marker
 * segments and stops at the first SOF (baseline C0 or progressive C2 and the
 * rest of the family), which is where the dimensions live.
 */
function jpegSize(buf: Buffer): { width: number; height: number } {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG");
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    let marker = buf[i + 1]!;
    while (marker === 0xff) {
      i += 1;
      marker = buf[i + 1]!;
    }
    i += 2;
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    const length = buf.readUInt16BE(i);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
    i += length;
  }
  throw new Error("no SOF marker in JPEG");
}
