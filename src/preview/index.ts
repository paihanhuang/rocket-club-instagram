/**
 * The review page: one real draft per pillar, with its slides, caption, flags
 * and timing, laid out for a phone. `renderPreview` is pure; the CLI feeds it
 * drafts from disk and publishes the result. Model text is always escaped.
 */
import type { Draft, Pillar } from "../newsroom/types.js";
import { TZ } from "../newsroom/time.js";

export type PreviewEntry = { draft: Draft; slides: string[]; seconds?: number | undefined };
export type PreviewRun = { date: string; pillar: string; seconds: number; ok: boolean; draftId?: string | undefined };
export type PreviewInput = {
  generatedAt: string;
  handle: string;
  entries: PreviewEntry[];
  runs?: PreviewRun[] | undefined;
};

const PILLAR_LABEL: Record<Pillar, string> = {
  launches: "Launches",
  opportunities: "Opportunities",
  explainer: "Explainer",
  neighbors: "Neighbors",
  weekend: "This weekend",
  club: "Our club",
  review: "Week in review",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const when = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function pt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${when.format(d)} PT`;
}

function seconds(value: number | undefined): string {
  return value === undefined ? "" : `${Math.round(value)} s`;
}

function entryHtml(entry: PreviewEntry): string {
  const { draft, slides } = entry;
  const { assignment, text } = draft;
  const label = PILLAR_LABEL[assignment.pillar] ?? assignment.pillar;
  const slideImgs = slides
    .map((src, i) => `<figure class="slide"><img src="${src}" alt="Slide ${i + 1} of ${slides.length}" width="1080" height="1350" loading="lazy"></figure>`)
    .join("");
  const flags =
    text.flags.length === 0
      ? `<p class="clean">No flags. The model was sure of every date and place it used.</p>`
      : `<ul class="flags">${text.flags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`;
  const hashtags = text.hashtags.map((h) => `#${escapeHtml(h)}`).join(" ");
  return `
<section class="post" style="--accent: var(--${assignment.pillar})">
  <p class="eyebrow"><span class="dot"></span>${escapeHtml(label)} <span class="sep">·</span> ${escapeHtml(assignment.date)}${entry.seconds === undefined ? "" : ` <span class="sep">·</span> <span class="mono">${seconds(entry.seconds)} to draft</span>`}</p>
  <h2>${escapeHtml(text.headline)}</h2>
  <p class="angle">Assignment: ${escapeHtml(assignment.angle)}</p>
  <div class="strip" aria-label="Slides">${slideImgs}</div>
  <div class="detail">
    <div class="caption">
      <p class="label">Caption as it would post</p>
      <pre>${escapeHtml(text.caption)}</pre>
      <p class="tags mono">${hashtags}</p>
    </div>
    <aside class="meta">
      <p class="label">Flags for the approver</p>
      ${flags}
      <p class="label">Publish by</p>
      <p class="mono">${escapeHtml(pt(draft.publishBy))}</p>
      <p class="label">Source line</p>
      <p>${escapeHtml(text.sourceLine)}</p>
      <p class="label">Draft</p>
      <p class="mono small">${escapeHtml(draft.id)} · ref ${escapeHtml(draft.contentHash.slice(0, 12))}</p>
    </aside>
  </div>
</section>`;
}

function runsHtml(runs: PreviewRun[]): string {
  if (runs.length === 0) return "";
  const rows = runs
    .map(
      (r) =>
        `<tr><td class="mono">${escapeHtml(r.date)}</td><td>${escapeHtml(PILLAR_LABEL[r.pillar as Pillar] ?? r.pillar)}</td><td class="mono num">${escapeHtml(seconds(r.seconds))}</td><td class="${r.ok ? "ok" : "bad"}">${r.ok ? "drafted" : "failed"}</td></tr>`,
    )
    .join("");
  const passed = runs.filter((r) => r.ok).length;
  const total = runs.reduce((a, r) => a + r.seconds, 0);
  return `
<section class="runs">
  <h2>Gate runs so far</h2>
  <p class="muted">${passed} of ${runs.length} drafted without help · ${Math.round(total / 60)} minutes of model time · every run on the local Qwen 3.8 27B through qwen code</p>
  <div class="scroll"><table>
    <thead><tr><th>Date</th><th>Pillar</th><th class="num">Time</th><th>Result</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</section>`;
}

export function renderPreview(input: PreviewInput): string {
  const entries = input.entries.map(entryHtml).join("\n");
  return `<title>lahsrocketry Newsroom Preview</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root {
  --ground: #F3F5F9; --panel: #FFFFFF; --ink: #0E1A2B; --muted: #5B6B85; --line: #D9DFEA;
  --flag-bg: #FFF1E6; --flag-ink: #8A3B00; --ok: #1E8E5A; --bad: #B3261E;
  --launches: #C2540A; --opportunities: #1F8A4C; --explainer: #0B7FB5; --neighbors: #6D4CC7;
  --weekend: #A97B00; --club: #C62828; --review: #3F4F6B;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0B1422; --panel: #12203A; --ink: #F4F6FA; --muted: #9AA7BD; --line: #22304A;
    --flag-bg: #3A2412; --flag-ink: #FFC28A; --ok: #5BD28F; --bad: #FF8A80;
    --launches: #FF7A1A; --opportunities: #2ECC71; --explainer: #4FC3F7; --neighbors: #B388FF;
    --weekend: #FFD54F; --club: #FF5252; --review: #E0E6F0;
  }
}
:root[data-theme="dark"] {
  --ground: #0B1422; --panel: #12203A; --ink: #F4F6FA; --muted: #9AA7BD; --line: #22304A;
  --flag-bg: #3A2412; --flag-ink: #FFC28A; --ok: #5BD28F; --bad: #FF8A80;
  --launches: #FF7A1A; --opportunities: #2ECC71; --explainer: #4FC3F7; --neighbors: #B388FF;
  --weekend: #FFD54F; --club: #FF5252; --review: #E0E6F0;
}
body { margin: 0; background: var(--ground); color: var(--ink); font-family: "IBM Plex Sans", -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 16px; line-height: 1.5; }
.wrap { max-width: 1040px; margin: 0 auto; padding-block: 28px 72px; padding-inline: 16px; }
h1, h2, h3 { font-family: "Bricolage Grotesque", "IBM Plex Sans", -apple-system, sans-serif; text-wrap: balance; margin: 0; line-height: 1.1; }
h1 { font-size: clamp(2rem, 6vw, 3.2rem); font-weight: 700; letter-spacing: -0.01em; }
h2 { font-size: clamp(1.35rem, 3.6vw, 1.9rem); font-weight: 700; margin-block: 6px 4px; }
.mono { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
.small { font-size: 0.85rem; }
.muted { color: var(--muted); }
.eyebrow { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.eyebrow .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent, var(--muted)); display: inline-block; }
.eyebrow .sep { color: var(--line); }
header.top { display: grid; gap: 12px; padding-block-end: 24px; border-bottom: 1px solid var(--line); }
header.top p { margin: 0; max-width: 65ch; }
.how { display: grid; gap: 6px; margin: 0; padding-inline-start: 20px; max-width: 65ch; }
.runs { padding-block: 28px; border-bottom: 1px solid var(--line); }
.runs p { margin-block: 6px 12px; }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.95rem; }
th, td { text-align: left; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 500; }
.num { text-align: right; }
.ok { color: var(--ok); } .bad { color: var(--bad); }
.post { padding-block: 32px; border-bottom: 1px solid var(--line); display: grid; gap: 12px; }
.post .angle { margin: 0; color: var(--muted); max-width: 65ch; }
.strip { display: flex; gap: 12px; overflow-x: auto; scroll-snap-type: x mandatory; padding-block: 8px; -webkit-overflow-scrolling: touch; }
.slide { margin: 0; flex: 0 0 auto; width: min(260px, 72vw); scroll-snap-align: start; }
.slide img { display: block; width: 100%; height: auto; max-width: 100%; aspect-ratio: 4 / 5; border-radius: 6px; border: 1px solid var(--line); background: #0E1A2B; }
.detail { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 720px) { .detail { grid-template-columns: 1fr; } }
.label { font-family: "IBM Plex Mono", ui-monospace, Menlo, monospace; font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 14px 0 4px; }
.label:first-child { margin-top: 0; }
.caption pre { font: inherit; white-space: pre-wrap; margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; max-width: 65ch; }
.caption .tags { margin: 8px 0 0; color: var(--muted); font-size: 0.9rem; word-break: break-word; }
.meta p { margin: 0; }
.flags { margin: 0; padding: 10px 12px 10px 28px; background: var(--flag-bg); color: var(--flag-ink); border-radius: 8px; display: grid; gap: 6px; }
.clean { color: var(--ok); margin: 0; }
footer { padding-block-start: 24px; color: var(--muted); font-size: 0.9rem; }
@media (prefers-reduced-motion: no-preference) { .strip { scroll-behavior: smooth; } }
</style>
<div class="wrap">
  <header class="top">
    <p class="eyebrow">Newsroom preview <span class="sep">·</span> generated ${escapeHtml(pt(input.generatedAt))}</p>
    <h1>${escapeHtml(input.handle)}</h1>
    <p>These are real drafts from the readiness gate: the local model wrote every word, the renderer made every slide, and nothing here was posted. One draft per pillar is shown, exactly as it would land in the Discord approval channel.</p>
    <ol class="how">
      <li>Does the first line make a classmate stop scrolling?</li>
      <li>Is every date, place and number right? The flags mark where the model was unsure.</li>
      <li>Do the slides read at thumbnail size?</li>
      <li>Would you tap approve? If not, say what you would change and the voice guide gets edited, not the post.</li>
    </ol>
  </header>
  ${runsHtml(input.runs ?? [])}
  ${entries}
  <footer>${input.entries.length} drafts shown · slides are 1080×1350 JPEGs, the format Instagram accepts · publish-by is the moment after which a draft is never posted</footer>
</div>`;
}
