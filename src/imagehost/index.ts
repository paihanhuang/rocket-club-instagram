/**
 * Image host adapter. Instagram will cURL the slides itself, so every JPEG has
 * to sit on a public URL first ("the image must be on a public server",
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/).
 * We use the repo's own GitHub Pages branch: zero budget, no extra account.
 *
 * Two things the panel verdict fixed (docs/design/panel-verdict.md, 5 and 6):
 * Pages publishing is not instant, so a URL is polled until it really serves an
 * image ("up to 10 minutes",
 * https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site);
 * and the JPEGs are deleted again once Instagram has a media id.
 *
 * Writes go through the GitHub Contents API with the injected `fetch`:
 *   GET    /repos/{owner}/{repo}/contents/{path}?ref={branch}   → the current sha
 *   PUT    /repos/{owner}/{repo}/contents/{path}                → create or update
 *   DELETE /repos/{owner}/{repo}/contents/{path}                → remove
 */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { Fetch, ImageHostPort } from "../newsroom/ports.js";

const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 12 * 60_000;

export class ImageHostError extends Error {
  readonly status: number | undefined;
  readonly body: string;
  /** For a wait that ran out: the URLs that never served an image. */
  readonly missing: readonly string[];
  constructor(message: string, detail: { status?: number; body?: string; missing?: string[] } = {}) {
    super(message);
    this.name = "ImageHostError";
    this.status = detail.status;
    this.body = detail.body ?? "";
    this.missing = detail.missing ?? [];
  }
}

export type GitHubPagesConfig = {
  owner: string;
  repo: string;
  /** The branch GitHub Pages serves. */
  branch: string;
  /** Directory inside that branch, e.g. "media". */
  dir: string;
  /** Public site root, e.g. "https://paihanhuang.github.io/rocket-club-instagram". */
  siteBase: string;
  fetch: Fetch;
  /** A token with contents:write. Falls back to `gh auth token` on this Mac. */
  token?: string;
  /** Seams for tests; production leaves these alone. */
  apiBase?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
};

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let cachedGhToken: string | undefined;
/** The gh CLI is logged in on this Mac; asking it once beats keeping a PAT. */
function ghAuthToken(): string {
  if (cachedGhToken) return cachedGhToken;
  let out = "";
  try {
    out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new ImageHostError(
      `could not read a GitHub token from \`gh auth token\`: ${err instanceof Error ? err.message : String(err)}. Pass cfg.token or run \`gh auth login\`.`,
    );
  }
  if (!out) throw new ImageHostError("`gh auth token` printed nothing; run `gh auth login`");
  cachedGhToken = out;
  return out;
}

export function createGitHubPagesHost(cfg: GitHubPagesConfig): ImageHostPort {
  const apiBase = (cfg.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const siteBase = cfg.siteBase.replace(/\/$/, "");
  const sleep = cfg.sleep ?? wait;
  const clock = cfg.now ?? Date.now;
  const pollIntervalMs = cfg.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const token = (): string => cfg.token ?? ghAuthToken();
  const contentsUrl = (name: string): string =>
    `${apiBase}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.dir}/${encodeURIComponent(name)}`;
  let bust = 0;

  async function api(
    what: string,
    method: string,
    url: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token()}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "lahsrocketry-newsroom",
    };
    if (body) headers["content-type"] = "application/json";
    const res = await cfg.fetch(url, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => "");
      throw new ImageHostError(`GitHub ${what} failed with ${res.status}: ${text.slice(0, 400)}`, {
        status: res.status,
        body: text,
      });
    }
    return res;
  }

  /** The sha the Contents API needs to overwrite or delete; undefined when new. */
  async function currentSha(name: string): Promise<string | undefined> {
    const res = await api("lookup", "GET", `${contentsUrl(name)}?ref=${encodeURIComponent(cfg.branch)}`);
    if (res.status === 404) return undefined;
    const file = (await res.json().catch(() => ({}))) as { sha?: unknown };
    return typeof file.sha === "string" ? file.sha : undefined;
  }

  async function servesImage(url: string): Promise<boolean> {
    bust += 1;
    const probe = `${url}${url.includes("?") ? "&" : "?"}cb=${bust}-${clock()}`;
    let res: Response;
    try {
      res = await cfg.fetch(probe, {
        method: "GET",
        headers: { "cache-control": "no-cache", pragma: "no-cache" },
      });
    } catch {
      return false; // a DNS or TLS hiccup mid-propagation is just "not yet"
    }
    const type = res.headers.get("content-type") ?? "";
    try {
      await res.body?.cancel();
    } catch {
      // nothing to release
    }
    return res.status === 200 && type.toLowerCase().startsWith("image/");
  }

  return {
    async publish(files: { name: string; path: string }[]): Promise<string[]> {
      const urls: string[] = [];
      // One commit at a time: concurrent writes to the same branch collide.
      for (const file of files) {
        const content = (await readFile(file.path)).toString("base64");
        const sha = await currentSha(file.name);
        await api("publish", "PUT", contentsUrl(file.name), {
          message: `newsroom: ${sha ? "update" : "add"} ${cfg.dir}/${file.name}`,
          content,
          branch: cfg.branch,
          ...(sha ? { sha } : {}),
        });
        urls.push(`${siteBase}/${cfg.dir}/${file.name}`);
      }
      return urls;
    },

    async waitUntilServed(urls: string[], opts?: { timeoutMs?: number }): Promise<void> {
      const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const started = clock();
      const pending = new Set(urls);
      for (;;) {
        for (const url of [...pending]) {
          if (await servesImage(url)) pending.delete(url);
        }
        if (pending.size === 0) return;
        const elapsed = clock() - started;
        if (elapsed >= timeoutMs) {
          const missing = [...pending];
          throw new ImageHostError(
            `GitHub Pages did not serve ${missing.length} image(s) within ${Math.round(timeoutMs / 1000)}s: ${missing.join(", ")}`,
            { missing },
          );
        }
        await sleep(pollIntervalMs);
      }
    },

    async remove(names: string[]): Promise<void> {
      for (const name of names) {
        const sha = await currentSha(name);
        if (!sha) continue; // already gone
        await api("remove", "DELETE", contentsUrl(name), {
          message: `newsroom: remove ${cfg.dir}/${name}`,
          sha,
          branch: cfg.branch,
        });
      }
    },
  };
}
