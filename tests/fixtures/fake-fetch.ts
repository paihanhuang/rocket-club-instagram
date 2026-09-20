/**
 * The test seam for every network module: a `Fetch` that replays the recorded
 * fixtures in this directory and records what was asked for. No test in this
 * repository is allowed to touch the network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Fetch } from "../../src/newsroom/ports.js";

const here = dirname(fileURLToPath(import.meta.url));

export function fixturePath(name: string): string {
  return join(here, name);
}

/** The recorded response body, exactly as the service sent it. */
export function readFixture(name: string): string {
  return readFileSync(fixturePath(name), "utf8");
}

export type Route = {
  /** Matched against the whole request URL as a substring. */
  match: string;
  /** Fixture file to serve, or a literal body. */
  fixture?: string;
  body?: string | Uint8Array;
  status?: number;
  contentType?: string;
  /** Fail the request the way a dead host does, rather than with a status. */
  throws?: string;
};

export type FakeFetch = Fetch & {
  /** Every URL asked for, in order. */
  readonly calls: string[];
  /** How many times a URL containing `part` was asked for. */
  countOf(part: string): number;
};

/**
 * Serves the first route whose `match` appears in the URL. An unmatched URL is
 * a test bug, so it throws loudly rather than returning a 404.
 */
export function fakeFetch(routes: Route[]): FakeFetch {
  const calls: string[] = [];

  const fn = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push(url);

    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`fakeFetch: no route for ${url}`);
    if (route.throws) throw new Error(route.throws);

    const body = route.fixture ? readFixture(route.fixture) : (route.body ?? "");
    const headers: Record<string, string> = {};
    if (route.contentType) headers["content-type"] = route.contentType;
    const status = route.status ?? 200;
    // 204 and 304 may not carry a body.
    return new Response(status === 204 || status === 304 ? null : (body as BodyInit), {
      status,
      headers,
    });
  };

  return Object.assign(fn, {
    calls,
    countOf: (part: string) => calls.filter((c) => c.includes(part)).length,
  }) as FakeFetch;
}
