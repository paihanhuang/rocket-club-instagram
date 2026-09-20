/**
 * Instagram adapter: "Instagram API with Instagram Login", which needs no
 * Facebook Page and no App Review for an account we own
 * (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login,
 * https://developers.facebook.com/docs/instagram-platform/app-review).
 *
 * Host and version: Meta's content publishing guide writes every call as
 * `https://<HOST_URL>/<LATEST_API_VERSION>/<IG_ID>/media`, where HOST_URL is
 * `graph.instagram.com` on this path and the page renders LATEST_API_VERSION as
 * v26.0 today — so the default below carries a version prefix, and `apiBase`
 * pins a different one when Meta moves on
 * (https://developers.facebook.com/docs/instagram-platform/content-publishing).
 * The token endpoints are the exception: Meta documents them unversioned, as
 * `https://graph.instagram.com/refresh_access_token`
 * (https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login),
 * so refreshes go to the host root.
 *
 * Endpoints used:
 *   POST /{ig-id}/media                     image or carousel container
 *   GET  /{container-id}?fields=status_code  IN_PROGRESS → FINISHED
 *   POST /{ig-id}/media_publish              creation_id → media id
 *   GET  /{media-id}?fields=permalink        the live link for the Discord notice
 *   GET  /{ig-id}/content_publishing_limit   quota before publishing
 *   GET  /refresh_access_token               60-day token, refreshed at day 50
 *   GET  /me?fields=id,username              identity check for doctor
 */
import type { Clock, Fetch, InstagramPort } from "../newsroom/ports.js";

const DEFAULT_API_BASE = "https://graph.instagram.com/v26.0";
/** Meta's own retry advice for transient throttling; one attempt, then give up. */
const RETRY_DELAY_MS = 5_000;
/** code 4 = application request limit, code 17 = user request limit. */
const THROTTLE_CODES = new Set([4, 17]);
const CONTAINER_STATES = ["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"] as const;
type ContainerState = (typeof CONTAINER_STATES)[number];
/**
 * The reference page documents quota_total as 50 while the publishing guide
 * says 100; 50 is the safe read when the field is missing altogether.
 */
const FALLBACK_QUOTA_TOTAL = 50;

type GraphError = { message?: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };

export class InstagramError extends Error {
  readonly status: number;
  readonly code: number | undefined;
  readonly errorSubcode: number | undefined;
  readonly fbtraceId: string | undefined;
  readonly body: string;
  constructor(what: string, status: number, error: GraphError, body: string) {
    super(`Instagram ${what} failed with ${status}: ${error.message ?? body.slice(0, 300)}`);
    this.name = "InstagramError";
    this.status = status;
    this.code = error.code;
    this.errorSubcode = error.error_subcode;
    this.fbtraceId = error.fbtrace_id;
    this.body = body;
  }
}

export type InstagramConfig = {
  /** The Instagram professional account's user id. */
  userId: string;
  /** A long-lived token from the app dashboard; 60 days, refreshable. */
  token: string;
  fetch: Fetch;
  apiBase?: string;
  /** Host root for the unversioned token endpoints. Defaults to apiBase's origin. */
  tokenBase?: string;
  /** Seams for tests; production leaves these alone. */
  now?: Clock;
  sleep?: (ms: number) => Promise<void>;
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Fields = Record<string, string | undefined>;

export function createInstagram(cfg: InstagramConfig): InstagramPort {
  const apiBase = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const tokenBase = (cfg.tokenBase ?? new URL(apiBase).origin).replace(/\/$/, "");
  const sleep = cfg.sleep ?? wait;
  const now = cfg.now ?? ((): Date => new Date());
  /** Kept mutable so a refresh keeps this client working. */
  let token = cfg.token;

  async function send(what: string, method: "GET" | "POST", url: string, fields: Fields): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) params.set(key, value);
    }

    for (let attempt = 0; ; attempt++) {
      const res =
        method === "GET"
          ? await cfg.fetch(`${url}?${params.toString()}`, { method: "GET" })
          : await cfg.fetch(url, { method: "POST", body: params });
      const text = await res.text().catch(() => "");
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      if (res.ok) return parsed;

      const error = (parsed["error"] ?? {}) as GraphError;
      const retryable = res.status >= 500 || (error.code !== undefined && THROTTLE_CODES.has(error.code));
      if (attempt === 0 && retryable) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new InstagramError(what, res.status, error, text);
    }
  }

  const get = (what: string, path: string, fields: Fields): Promise<Record<string, unknown>> =>
    send(what, "GET", `${apiBase}${path}`, { ...fields, access_token: token });
  const post = (what: string, path: string, fields: Fields): Promise<Record<string, unknown>> =>
    send(what, "POST", `${apiBase}${path}`, { ...fields, access_token: token });

  function idOf(what: string, body: Record<string, unknown>): string {
    const id = body["id"];
    if (typeof id !== "string" && typeof id !== "number") {
      throw new InstagramError(what, 200, { message: "response carried no id" }, JSON.stringify(body));
    }
    return String(id);
  }

  return {
    async createImageContainer(req): Promise<{ id: string }> {
      const body = await post("create image container", `/${cfg.userId}/media`, {
        image_url: req.imageUrl,
        ...(req.isCarouselItem ? { is_carousel_item: "true" } : {}),
        ...(req.caption === undefined ? {} : { caption: req.caption }),
      });
      return { id: idOf("create image container", body) };
    },

    async createCarouselContainer(req): Promise<{ id: string }> {
      const body = await post("create carousel container", `/${cfg.userId}/media`, {
        media_type: "CAROUSEL",
        children: req.children.join(","),
        caption: req.caption,
      });
      return { id: idOf("create carousel container", body) };
    },

    async containerStatus(id): Promise<ContainerState> {
      const body = await get("read container status", `/${id}`, { fields: "status_code" });
      const status = body["status_code"];
      if (typeof status === "string" && (CONTAINER_STATES as readonly string[]).includes(status)) {
        return status as ContainerState;
      }
      throw new InstagramError(
        "read container status",
        200,
        { message: `unknown status_code ${String(status)}` },
        JSON.stringify(body),
      );
    },

    async publish(containerId): Promise<{ mediaId: string; permalink?: string }> {
      const published = await post("publish", `/${cfg.userId}/media_publish`, { creation_id: containerId });
      const mediaId = idOf("publish", published);
      // The link is a convenience for the Discord notice: never fail a published
      // post because the permalink lookup did not answer.
      try {
        const media = await get("read permalink", `/${mediaId}`, { fields: "permalink" });
        const permalink = media["permalink"];
        if (typeof permalink === "string") return { mediaId, permalink };
      } catch {
        // published is published
      }
      return { mediaId };
    },

    async quota(): Promise<{ used: number; total: number }> {
      const body = await get("read publishing quota", `/${cfg.userId}/content_publishing_limit`, {
        fields: "quota_usage,config",
      });
      const rows = body["data"];
      const row = (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : body) ?? {};
      const config = (row["config"] ?? {}) as { quota_total?: number };
      return {
        used: Number(row["quota_usage"] ?? 0),
        total: Number(config.quota_total ?? FALLBACK_QUOTA_TOTAL),
      };
    },

    async refreshToken(): Promise<{ token: string; expiresAt: string }> {
      const body = await send("refresh token", "GET", `${tokenBase}/refresh_access_token`, {
        grant_type: "ig_refresh_token",
        access_token: token,
      });
      const fresh = body["access_token"];
      if (typeof fresh !== "string") {
        throw new InstagramError("refresh token", 200, { message: "no access_token in response" }, JSON.stringify(body));
      }
      const seconds = Number(body["expires_in"] ?? 0);
      token = fresh;
      return { token: fresh, expiresAt: new Date(now().getTime() + seconds * 1000).toISOString() };
    },

    async me(): Promise<{ id: string; username: string }> {
      const body = await get("read account", "/me", { fields: "id,username" });
      return { id: String(body["id"] ?? ""), username: String(body["username"] ?? "") };
    },
  };
}
