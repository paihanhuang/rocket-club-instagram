# Architecture panel verdict (2026-09-19)

Four seats: Claude (orchestrator, full voting member), Codex (OpenAI), Grok
(xAI), Antigravity (Google). Three rounds: sealed entries, a collision round
with anonymized rivals, and a beat-the-leader round. No seat was dropped.
Facts asserted during the panel were checked against primary docs; see
`docs/research/instagram-publishing-facts.md`. Panels establish judgment, not
facts: every number below comes from a fetched source or is tagged.

## The answer

1. **A TypeScript runner drives the fixed daily sequence.** The local model is
   called only inside the write step, through qwen code headless with
   `--max-tool-calls 0`, `--json-schema`, `--max-wall-time` and the sandbox on,
   so qwen code is the model's tuned harness for generation with no ability to
   act. All four seats ended here. Round 1 had three seats recommending a
   plain program and one (Claude) defending the agent-as-driver; the verified
   qwen code flags made the merge possible. *This changes ADR-0001 and needs
   the account owner's sign-off.*
2. **Generation runs in the evening, publishing on the first wake after 15:00.**
   Grok's round-3 point: a closed-lid MacBook does not run a 06:30 job, and
   the Mac is attended in the evening. On-wake catch-up stays for a missing
   draft.
3. **Approval by emoji reaction, read over REST.** No gateway process; buttons
   need a live bot and fail when the Mac sleeps. An approval binds to the
   draft's content hash. Reacting approve means "I confirmed every flag on
   the card."
4. **Every draft carries a `publishBy` time**, set from the item's own deadline
   or event time when there is one, else creation plus 36 hours. The publisher
   requires an unchanged approved hash and `now < publishBy`. Expired drafts
   are never queued; the day is skipped or an evergreen explainer is used.
   (Codex, round 3.)
5. **Publisher is a durable, idempotent state machine.** One JSON record per
   draft; container ids recorded before Instagram is called; reconciliation
   before any retry. JPEG 1080x1350 only; Pages URL polled until 200 with an
   image content type; child containers, FINISHED, parent CAROUSEL,
   media_publish; quota checked first; token refreshed at day 50 with a
   Discord reminder on failure.
6. **JPEGs are deleted from the Pages branch after Meta returns a media id.**
   Meta has fetched them; leaving club photos on a public mirror forever is a
   fence miss. (Grok, round 3.) Supersedes the "Pages as public archive" idea
   in ADR-0003.
7. **Day-zero publish spike.** One real carousel end to end the day the account
   and Meta app exist. Until it passes, officers post the Discord draft from a
   phone; the launch date does not depend on the API.
8. **Week one's plan is hand-written; the Sunday cloud editor is deferred.**
   Account insights are unavailable below 100 followers (verified), so there
   is nothing for it to read yet.
9. **Growth is a human routine, not a feature.** The "published" message in
   Discord carries the live link and a share checklist; the plan includes a
   weekly officer distribution routine. (Codex and Grok; all seats agreed the
   150-follower target is not reached by posting alone.)
10. **The gate becomes 18 fixture dry runs plus three editorial acceptance
    cases**: a deadline before 15:00, a wake after an event's useful window,
    and an approved draft with an unresolved flag. It measures completion and
    draft validity, not agent orchestration.

## Attribution

| Point | Origin | Fate |
|---|---|---|
| Program drives, model only writes | Codex, Grok, Antigravity (r1) | Adopted, merged with qwen code as tool-less writer harness (Claude r2) |
| Reactions over REST instead of buttons | Grok (r1), Antigravity (r2) | Adopted |
| Durable state machine, hash-bound approval, reconciliation | Codex (r1) | Adopted, kept lightweight |
| JPEG only, poll Pages until 200 | Claude (r1) | Adopted, confirmed by Meta docs |
| Manual phone-post fallback, spike first | Claude, Codex, Grok (r1) | Adopted |
| MTPLX health check and start | Antigravity (r1) | Adopted |
| Evening generation, wake-publish | Grok (r3) | Adopted |
| `publishBy` validity gate | Codex (r3) | Adopted |
| Purge Pages after publish | Grok (r3) | Adopted |
| Distribution routine, share checklist | Codex (r1), Grok (r3) | Adopted |
| Defer Sunday editor, hand-write week one | All | Adopted |

## Killed claims (disclosed)

- "Use raw.githubusercontent.com as the image host" (Grok r1): killed. Checked
  live; it serves images as `text/plain`.
- "Publishing needs a Facebook Page and App Review" (Grok r1): killed. Meta's
  docs: the Instagram-Login path needs no Page, and App Review is not required
  for an app used only for a business you own.
- "Use Cloudflare R2 or S3" (Antigravity r1): killed. Violates the zero-budget,
  no-extra-accounts constraint; the Pages race is fixed by polling.
- "Meta platform terms require age 18" (Grok r3, tagged from memory): not
  found. The Platform Terms and the registration page state no age rule. What
  registration does require is a Facebook account plus phone and email
  verification, which is now in the setup guide.
- "The account plateaus under 30 followers without Reels" (Antigravity r1):
  unsourced number; dropped. The underlying growth concern was kept.
- "Claim-level evidence gate before every approval" (Codex r1): reduced to the
  `publishBy` field and the flag rule; the full version was judged too heavy
  for a one-week build (Grok, Antigravity r2).

## Dissent preserved verbatim

Grok, round 3, on the runbook: "the leader still models a daytime server and
an API-default launch. The 60-day risk is the laptop's duty cycle, the 18+ app
gate, and an immortal public photo mirror." Two of the three were adopted; the
age gate was checked and not found.

Codex, round 2, on the human gate: "Human approval can accept incorrect facts,
and the design does not bind approval to an immutable artifact or prevent
stale publication. Passing cached dry runs cannot establish those
protections." Adopted through points 3, 4 and 10.

Antigravity, round 3: "FOLD: The leading answer comprehensively resolves every
core failure mode by constraining the local model to deterministic zero-tool
structured generation, replacing persistent bot infrastructure with REST
reaction polling, handling GitHub Pages CDN propagation and Instagram
container idempotency, and establishing a zero-risk phone fallback backed by
an active human distribution strategy."

Round files: kept in the session scratchpad under `panel/architecture/`.
