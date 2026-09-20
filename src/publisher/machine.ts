/**
 * The publish state machine: pure, and the whole reason an interrupted
 * publish can be finished instead of repeated.
 *
 * `resume(draft, now)` reads a draft record — including one left behind by a
 * crashed run — and says where the publish stands. `next(state, event)` moves
 * it on and returns the commands the driver should execute. Nothing here
 * touches the network, the disk or the clock, so every crash-and-resume path
 * is a test with literal events.
 *
 * Internal to the publisher: `src/publisher/index.ts` does not re-export it.
 */
import type { Draft, DraftText } from "../newsroom/types.js";

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** Instagram polls: every 5 seconds for at most 5 minutes. */
export const POLL_INTERVAL_MS = 5_000;
export const MAX_POLLS = 60;

export type PublishPlan = {
  draftId: string;
  /** The slide files to make public, named `<draftId>-<n>.jpg`. */
  files: { name: string; path: string }[];
  caption: string;
  startedAt: string;
};

export type State =
  | { phase: "host"; plan: PublishPlan }
  | { phase: "serve"; plan: PublishPlan; imageUrls: string[] }
  | { phase: "single"; plan: PublishPlan; imageUrls: string[] }
  | { phase: "children"; plan: PublishPlan; imageUrls: string[]; containerIds: string[] }
  | { phase: "poll"; plan: PublishPlan; imageUrls: string[]; containerIds: string[]; polls: number }
  | { phase: "parent"; plan: PublishPlan; imageUrls: string[]; containerIds: string[] }
  | { phase: "pollParent"; plan: PublishPlan; carouselId: string; polls: number }
  | { phase: "publish"; plan: PublishPlan; containerId: string }
  | { phase: "published"; plan: PublishPlan; mediaId?: string | undefined; permalink?: string | undefined }
  | { phase: "reset"; plan: PublishPlan; reason: string }
  | { phase: "failed"; plan: PublishPlan; message: string };

export type Event =
  | { type: "begin" }
  | { type: "hosted"; urls: string[] }
  | { type: "served" }
  | { type: "container"; id: string }
  | { type: "statuses"; statuses: ContainerStatus[] }
  | { type: "status"; status: ContainerStatus };

export type PublishedEvent = { type: "publishedOk"; mediaId: string; permalink?: string | undefined };
export type AnyEvent = Event | PublishedEvent;

export type Command =
  | { type: "hostImages"; files: { name: string; path: string }[] }
  | { type: "saveImageUrls"; urls: string[] }
  | { type: "waitServed"; urls: string[] }
  | { type: "createSingle"; imageUrl: string; caption: string }
  | { type: "createChild"; imageUrl: string; index: number }
  | { type: "saveContainerIds"; ids: string[] }
  | { type: "sleep"; ms: number }
  | { type: "pollChildren"; ids: string[] }
  | { type: "pollContainer"; id: string }
  | { type: "createCarousel"; children: string[]; caption: string }
  | { type: "saveCarouselId"; id: string }
  | { type: "publish"; containerId: string }
  | { type: "markPublished"; mediaId?: string | undefined; permalink?: string | undefined }
  | { type: "removeImages"; names: string[] }
  | { type: "announce"; permalink?: string | undefined; mediaId?: string | undefined }
  | { type: "markFailed"; message: string }
  | { type: "reset"; reason: string };

export type Step = { state: State; commands: Command[] };

/** What Instagram is sent: the caption, a blank line, then the hashtags. */
export function captionFor(text: DraftText): string {
  const tags = text.hashtags.map((h) => `#${h}`).join(" ");
  return tags ? `${text.caption}\n\n${tags}` : text.caption;
}

export function imageNameFor(draftId: string, index: number): string {
  return `${draftId}-${index + 1}.jpg`;
}

export function planFor(draft: Draft, now: Date): PublishPlan {
  return {
    draftId: draft.id,
    files: draft.slides.map((slide, i) => ({ name: imageNameFor(draft.id, i), path: slide.path })),
    caption: captionFor(draft.text),
    startedAt: now.toISOString(),
  };
}

export const imageNamesOf = (plan: PublishPlan): string[] => plan.files.map((f) => f.name);

/**
 * Where this draft's publish stands. A draft with no publish record starts at
 * the beginning; one left in `publishing` by a crashed run picks up from the
 * last id it managed to write down, and never recreates something recorded.
 */
export function resume(draft: Draft, now: Date): State {
  const plan = planFor(draft, now);
  const record = draft.publish;
  if (!record) return { phase: "host", plan };

  if (record.mediaId) {
    return {
      phase: "published",
      plan,
      mediaId: record.mediaId,
      ...(record.permalink === undefined ? {} : { permalink: record.permalink }),
    };
  }
  if (record.carouselId) {
    return { phase: "pollParent", plan, carouselId: record.carouselId, polls: 0 };
  }

  const imageUrls = record.imageUrls ?? [];
  const containerIds = record.containerIds ?? [];
  if (containerIds.length === 0) {
    return { phase: "reset", plan, reason: "nothing was created before the interruption" };
  }
  const single = containerIds[0];
  if (draft.slides.length === 1 && containerIds.length === 1 && single) {
    return { phase: "publish", plan, containerId: single };
  }
  if (imageUrls.length === 0) {
    return { phase: "reset", plan, reason: "containers exist but no image urls were recorded" };
  }
  if (containerIds.length >= imageUrls.length) {
    return { phase: "poll", plan, imageUrls, containerIds, polls: 0 };
  }
  return { phase: "children", plan, imageUrls, containerIds };
}

/** The commands a state asks for the moment it is entered. */
function enter(state: State): Step {
  switch (state.phase) {
    case "host":
      return { state, commands: [{ type: "hostImages", files: state.plan.files }] };

    case "serve":
      return {
        state,
        commands: [
          { type: "saveImageUrls", urls: state.imageUrls },
          { type: "waitServed", urls: state.imageUrls },
        ],
      };

    case "single": {
      const url = state.imageUrls[0];
      if (!url) return enter({ phase: "failed", plan: state.plan, message: "no image url to publish" });
      return {
        state,
        commands: [{ type: "createSingle", imageUrl: url, caption: state.plan.caption }],
      };
    }

    case "children": {
      const index = state.containerIds.length;
      if (index >= state.imageUrls.length) {
        return enter({
          phase: "poll",
          plan: state.plan,
          imageUrls: state.imageUrls,
          containerIds: state.containerIds,
          polls: 0,
        });
      }
      const url = state.imageUrls[index];
      if (!url) return enter({ phase: "failed", plan: state.plan, message: "missing image url" });
      return { state, commands: [{ type: "createChild", imageUrl: url, index }] };
    }

    case "poll":
      return {
        state,
        commands: [
          ...(state.polls > 0 ? [{ type: "sleep" as const, ms: POLL_INTERVAL_MS }] : []),
          { type: "pollChildren", ids: state.containerIds },
        ],
      };

    case "parent":
      return {
        state,
        commands: [
          { type: "createCarousel", children: state.containerIds, caption: state.plan.caption },
        ],
      };

    case "pollParent":
      return {
        state,
        commands: [
          ...(state.polls > 0 ? [{ type: "sleep" as const, ms: POLL_INTERVAL_MS }] : []),
          { type: "pollContainer", id: state.carouselId },
        ],
      };

    case "publish":
      return { state, commands: [{ type: "publish", containerId: state.containerId }] };

    case "published":
      return {
        state,
        commands: [
          { type: "markPublished", mediaId: state.mediaId, permalink: state.permalink },
          { type: "removeImages", names: imageNamesOf(state.plan) },
          { type: "announce", mediaId: state.mediaId, permalink: state.permalink },
        ],
      };

    case "reset":
      return { state, commands: [{ type: "reset", reason: state.reason }] };

    case "failed":
      return { state, commands: [{ type: "markFailed", message: state.message }] };
  }
}

const stay = (state: State): Step => ({ state, commands: [] });

function afterPoll(
  state: Extract<State, { phase: "poll" }>,
  statuses: ContainerStatus[],
): Step {
  if (statuses.some((s) => s === "ERROR" || s === "EXPIRED")) {
    return enter({
      phase: "failed",
      plan: state.plan,
      message: `Instagram rejected a slide container (${statuses.join(", ")})`,
    });
  }
  if (statuses.every((s) => s === "FINISHED" || s === "PUBLISHED")) {
    return enter({
      phase: "parent",
      plan: state.plan,
      imageUrls: state.imageUrls,
      containerIds: state.containerIds,
    });
  }
  const polls = state.polls + 1;
  if (polls >= MAX_POLLS) {
    return enter({
      phase: "failed",
      plan: state.plan,
      message: `slide containers were not ready after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`,
    });
  }
  return enter({ ...state, polls });
}

function afterParentPoll(
  state: Extract<State, { phase: "pollParent" }>,
  status: ContainerStatus,
): Step {
  switch (status) {
    case "PUBLISHED":
      return enter({ phase: "published", plan: state.plan });
    case "FINISHED":
      return enter({ phase: "publish", plan: state.plan, containerId: state.carouselId });
    case "ERROR":
    case "EXPIRED":
      return enter({
        phase: "reset",
        plan: state.plan,
        reason: `the carousel container came back ${status}`,
      });
    case "IN_PROGRESS": {
      const polls = state.polls + 1;
      if (polls >= MAX_POLLS) {
        return enter({
          phase: "failed",
          plan: state.plan,
          message: `the carousel container was not ready after ${(MAX_POLLS * POLL_INTERVAL_MS) / 60_000} minutes`,
        });
      }
      return enter({ ...state, polls });
    }
  }
}

/** One move. `begin` asks a state for the commands it was entered with. */
export function next(state: State, event: AnyEvent): Step {
  if (event.type === "begin") return enter(state);

  switch (state.phase) {
    case "host":
      if (event.type === "hosted") {
        if (event.urls.length === 0) {
          return enter({ phase: "failed", plan: state.plan, message: "the image host returned no urls" });
        }
        return enter({ phase: "serve", plan: state.plan, imageUrls: event.urls });
      }
      return stay(state);

    case "serve":
      if (event.type === "served") {
        return state.imageUrls.length === 1
          ? enter({ phase: "single", plan: state.plan, imageUrls: state.imageUrls })
          : enter({
              phase: "children",
              plan: state.plan,
              imageUrls: state.imageUrls,
              containerIds: [],
            });
      }
      return stay(state);

    case "single":
      if (event.type === "container") {
        const step = enter({ phase: "publish", plan: state.plan, containerId: event.id });
        return { state: step.state, commands: [{ type: "saveContainerIds", ids: [event.id] }, ...step.commands] };
      }
      return stay(state);

    case "children":
      if (event.type === "container") {
        const containerIds = [...state.containerIds, event.id];
        const step = enter({ ...state, containerIds });
        return {
          state: step.state,
          commands: [{ type: "saveContainerIds", ids: containerIds }, ...step.commands],
        };
      }
      return stay(state);

    case "poll":
      return event.type === "statuses" ? afterPoll(state, event.statuses) : stay(state);

    case "parent":
      if (event.type === "container") {
        const step = enter({ phase: "publish", plan: state.plan, containerId: event.id });
        return {
          state: step.state,
          commands: [{ type: "saveCarouselId", id: event.id }, ...step.commands],
        };
      }
      return stay(state);

    case "pollParent":
      return event.type === "status" ? afterParentPoll(state, event.status) : stay(state);

    case "publish":
      if (event.type === "publishedOk") {
        return enter({
          phase: "published",
          plan: state.plan,
          mediaId: event.mediaId,
          ...(event.permalink === undefined ? {} : { permalink: event.permalink }),
        });
      }
      return stay(state);

    case "published":
    case "reset":
    case "failed":
      return stay(state);
  }
}

export const isSettled = (state: State): boolean =>
  state.phase === "published" || state.phase === "reset" || state.phase === "failed";
