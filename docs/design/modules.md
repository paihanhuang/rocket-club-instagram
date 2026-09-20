# Module design

Vocabulary: **module** (interface + implementation), **interface** (everything a
caller must know), **seam** (where an interface lives), **adapter** (a thing
that satisfies an interface at a seam). Domain words come from `CONTEXT.md`.
The goal is deep modules: a lot of behaviour behind a small interface, tested
through that interface.

## Rules that come from the panel verdict

- Generation runs in the evening for the next day; publishing happens on the
  first publisher run after 15:00 local. A missing draft is generated on wake.
- Approval is an emoji reaction read over REST, bound to the content hash: the
  card prints the first 12 characters of the hash, and the verdict carries back
  what the card said, so a draft changed after posting cannot inherit a verdict.
  Reacting approve means every flag on the card was confirmed.
- `publishBy` comes from the item's own deadline or start time when one exists,
  else creation plus 36 hours. Publish requires `now < publishBy`.
- JPEGs are removed from the Pages branch once Instagram returns a media id.
- The "published" notice carries the live link and a share checklist.

## The daily sequence (the runner)

```
ensureModelServer → readAssignment → fetchItems → shortlist → findLicensedPhoto
→ writeDraft → renderSlides → store.save → discord.postDraft
```

`ensureModelServer` is an injected step like the others, so a model server that
will not start is reported to Discord the same way a dead feed is.

The runner is deliberately thin: it owns the order and the failure report,
nothing else. Every step is a module below. The publisher is a second, separate
sequence that runs on its own schedule.

## Domain types (src/newsroom/types.ts)

```ts
type Pillar = "launches" | "opportunities" | "explainer" | "neighbors" | "weekend" | "club" | "review";
type Assignment = { date: string; pillar: Pillar; angle: string };
type Item = { id: string; source: string; title: string; url: string; summary: string;
  publishedAt?: string; startsAt?: string; location?: { name: string; lat: number; lon: number };
  fetchedAt: string };
type Shortlist = { assignment: Assignment; items: Item[]; notes: string[] };
type LicensedPhoto = { url: string; license: string; credit: string; source: string; path: string };
type DraftText = { headline: string; slides: { title: string; body: string }[]; caption: string;
  sourceLine: string; hashtags: string[]; flags: string[] };
type DraftStatus = "pending" | "approved" | "rejected" | "expired" | "publishing" | "published" | "failed";
type Verdict = { decision: "approved" | "rejected"; by: string; at: string; contentHash: string };
type Draft = { id: string; assignment: Assignment; text: DraftText; slides: { path: string }[];
  photo?: LicensedPhoto; contentHash: string; createdAt: string; publishBy: string;
  status: DraftStatus; discordMessageId?: string; verdict?: Verdict;
  publish?: { imageUrls: string[]; containerIds: string[]; carouselId?: string; mediaId?: string; permalink?: string };
  error?: string };
```

Schemas for these live beside the types (zod), because `DraftText` is what the
model must produce and the schema is the contract with the writer harness.

## Modules

| Module | Interface (one line) | Hidden behind the seam | Dependency category, adapters |
|---|---|---|---|
| plan | `readAssignment(date, planDir) → Assignment` | Plan file parsing; rhythm fallback when no line exists | In-process |
| sources | `fetchItems(pillar, {now, fetch, cacheDir}) → { items, notes }` | Source registry, Launch Library and RSS parsing, disk cache with timestamps, rate-limit spacing | External: inject `fetch`; tests use recorded fixtures |
| shortlist | `shortlist(items, assignment, {now, home, notes?}) → Shortlist` | Time windows per pillar, distance from Los Altos, dedupe, ranking | In-process |
| license | `findLicensedPhoto(shortlist, {fetch, photoDir}) → LicensedPhoto \| undefined` | Whitelist rules, Wikimedia license lookup, download, consent list for club photos | External: inject `fetch` |
| writer | `writeDraft(assignment, shortlist, photo, guides, generate) → DraftText` | Prompt assembly from voice guide and fence, schema validation, one retry with the validation errors fed back | Local model behind a `Generate` port with three adapters: OpenAI-compatible HTTP (default), qwen code headless (optional, falls back to HTTP), fake |
| render | `renderSlides(text, pillar, photo, outDir, browser) → Slide[]` | Card templates, Playwright, JPEG 1080x1350 sRGB, cover and closing slide rules | Local-substitutable: real Chromium in tests, checked by parsing the JPEG header |
| discord | `createDiscord({token, channelId, approvers, fetch}) → { postDraft, readVerdict, notify }` | REST multipart upload, reaction listing, approver allowlist, message formatting with copyable caption | External: inject `fetch`; fake records calls |
| store | `createDraftStore(dir) → { save, get, list, transition }` | One JSON per draft, content hash, expiry, legal transitions only | Local-substitutable: temp dir |
| imagehost | `createImageHost(cfg) → { publish(files) → urls, waitUntilServed(urls) }` | Push to the Pages branch through the GitHub Contents API over `fetch` (token from `gh auth token` when none is given), poll until 200 with an image content type, remove after publish | Two adapters: GitHub Pages, fake |
| instagram | `createInstagram({userId, token, fetch}) → { publishCarousel, publishImage, quota, refreshToken }` | Child containers, FINISHED polling, parent container, media_publish, quota check | External: inject `fetch`; fake |
| runner | `runDaily({date, deps}) → RunResult`, `runPublisher({now, deps}) → PublishReport`, `ensureModelServer(cfg)` | Order, on-wake catch-up, failure report to Discord, publish window and expiry rules, reconciliation before retry | Composed from the modules above; tested with all fakes |
| doctor | `doctor(env) → Check[]` | Every credential and dependency probed without posting | Composed |

## Seam discipline

- `fetch` is the one injected dependency for every network module. Production
  passes the global; tests pass a fake that replays fixtures and records calls.
- The writer's `Generate` port is a real seam: the HTTP adapter is the default,
  the qwen code adapter is optional with HTTP behind it, and the fake is for
  tests. Callers of `writeDraft` never know which is in use.
- The store is the only place a draft's status changes. The runner and the
  publisher ask it to `transition`; they never write status themselves.
- The publisher records every container id the moment Instagram returns it,
  and on resume it asks Instagram for a recorded container's status before
  publishing it, so an interrupted publish never publishes twice.

## Testing strategy

- In-process modules (plan, shortlist, license rules, writer assembly and
  validation, store transitions): unit tests through the interface only.
- Network modules: tests with a fake `fetch` and recorded fixtures under
  `tests/fixtures/`. A `RUN_LIVE=1` contract test hits the real service and is
  skipped by default.
- Render: one real render per template, asserting JPEG format and dimensions.
- Runner: an integration test with every adapter faked, asserting the order of
  calls, the state transitions, and the failure report when a step throws.
- The gate (`pnpm tool gate`): 21 dry runs on fixture sources and the real
  local model, checking completion and `DraftText` validity.

## Layout

```
src/
  cli.ts            pnpm tool <name>
  newsroom/         types + schemas
  plan/ sources/ shortlist/ license/ writer/ render/ discord/ store/ imagehost/ instagram/ runner/ doctor/
guides/             voice.md, fence.md
templates/          one HTML card template per pillar + shared css
plan/               week plans (week one hand-written)
tests/fixtures/     recorded source responses
state/ out/ cache/  runtime only, git-ignored
```
