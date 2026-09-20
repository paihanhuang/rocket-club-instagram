# LAHS Rocketry Newsroom

The system behind the @lahsrocketry Instagram account: a small newsroom where a
weekly editor assigns stories, a daily worker drafts them, humans approve them,
and a publisher puts them on Instagram. This file is the shared vocabulary.
It is a glossary, not a spec.

## Editorial

**Pillar**:
One of the seven recurring topics, each owned by a weekday: Launches, Opportunities, Explainer, Neighbors, Weekend, Club, Review.
_Avoid_: category, theme, topic, series, content type

**Rhythm**:
The fixed mapping from weekday to pillar. Monday is Launches, Sunday is Review.
_Avoid_: schedule, calendar, editorial calendar, cadence

**Plan**:
The week's seven assignments, one per day, written by the chief.
_Avoid_: schedule, backlog, content calendar

**Assignment**:
One day's instruction in the plan: the date, the pillar, and an angle.
_Avoid_: task, ticket, brief, job

**Angle**:
The specific take an assignment asks for, such as "how to watch it live from the Bay Area".
_Avoid_: hook, spin, framing, prompt

**Fallback**:
The pillar used on a day whose assigned pillar has no usable material. Space history is the fallback for Club.
_Avoid_: backup, default, filler

## Roles

**Chief**:
The editor-in-chief: the cloud agent that writes the plan, reads insights, and maintains the newsroom. Runs weekly and on demand.
_Avoid_: planner, orchestrator, supervisor, editor

**Worker**:
The local agent that completes one assignment into one draft by following the checklist.
_Avoid_: pipeline, bot, runner, generator, daily job

**Approver**:
A person allowed to give a verdict on a draft. The president and any officer added to the approval channel.
_Avoid_: reviewer, admin, moderator, owner

**Publisher**:
The part that turns an approved draft into a post on Instagram.
_Avoid_: poster, uploader, scheduler

## Material

**Source**:
A place material is fetched from, with its trust level and license terms.
_Avoid_: feed, site, provider, channel

**Item**:
One piece of material from a source: a launch, an article, an event, an opening.
_Avoid_: entry, record, story, result

**Shortlist**:
The filtered and ranked items handed to the writer for one assignment.
_Avoid_: candidates, selection, picks

**Licensed photo**:
A photo from an allowed source whose license permits reuse and has been checked. NASA, SpaceX on Flickr, ESA and Wikimedia with an allowed tag, and the club's own photos.
_Avoid_: stock image, asset, picture, free image

**Consent list**:
The list of students who have agreed to appear in club photos. A photo showing a student not on it cannot be used.
_Avoid_: release, permission list

## Drafting

**Checklist**:
The fixed, ordered steps the worker follows to complete an assignment.
_Avoid_: skill, workflow, playbook, recipe, prompt

**Tool**:
One deterministic program the worker may call from the checklist: fetch, shortlist, license check, write, render, post draft.
_Avoid_: script, step, command, helper

**Run**:
One execution of the worker for one assignment. It ends in a draft or a failure report, never both.
_Avoid_: job, execution, session, attempt

**Draft**:
A complete candidate post waiting for a verdict: slides, caption, source line, hashtags, and flags.
_Avoid_: post, content, candidate, submission

**Slide**:
One image in a draft. The first slide is the cover. A draft has one to ten slides.
_Avoid_: card, image, page, frame

**Card template**:
The design a slide is rendered from. One per pillar, sharing the account's look.
_Avoid_: layout, theme, skin, design

**Source line**:
The line in every caption naming where the facts came from.
_Avoid_: citation, credit, attribution, reference

**Flag**:
A warning attached to a draft that every approver must see before deciding, such as "confirm before posting" or "no licensed photo".
_Avoid_: warning, alert, issue, note

**Voice guide**:
The written rules for how captions sound.
_Avoid_: style guide, tone, persona, brand voice

**Fence**:
The written hard rules a draft may never break, regardless of what the plan asks for.
_Avoid_: policy, guidelines, guardrails, content rules

## Review and publishing

**Verdict**:
An approver's call on a draft: approved or rejected, with who and when.
_Avoid_: decision, review, status, sign-off

**Expiry**:
The moment after which a draft may no longer be published, even if approved.
_Avoid_: TTL, deadline, timeout

**Publish window**:
The daily period in which the publisher may post approved drafts.
_Avoid_: slot, posting time, schedule

**Post**:
A draft that has been published, identified by its Instagram media id.
_Avoid_: publication, upload, content

**Insights**:
Instagram's own engagement numbers for a post or the account. Instagram's word, kept as is.
_Avoid_: analytics, metrics, stats, engagement data

## Readiness

**Dry run**:
A run whose draft goes to a test channel and can never be published.
_Avoid_: test mode, simulation, staging

**Gate**:
The readiness test before launch: every weekday assignment three times in a row, all as dry runs, with no human help.
_Avoid_: smoke test, acceptance test, burn-in
