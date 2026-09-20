/**
 * The checkup: every credential and dependency probed, nothing posted.
 *
 * It is the first thing the account owner runs after filling in `.env`, and
 * the first thing to run when something stops working. Each check answers one
 * question, catches its own failures, and prints one line, so a red line names
 * the thing to fix.
 */
import { access, mkdir, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Fetch, InstagramPort } from "../newsroom/ports.js";

export type Check = { name: string; ok: boolean; detail: string };

export type Env = Record<string, string | undefined>;

export type RunCommand = (
  argv: readonly string[],
) => Promise<{ code: number; stdout: string; stderr: string }>;

export type DoctorFs = {
  /** Creates the directory if it is missing; says which it was. */
  ensureDir(path: string): Promise<"exists" | "created">;
  listDir(path: string): Promise<string[]>;
};

export type DoctorDeps = {
  fetch: Fetch;
  run: RunCommand;
  /** Left out when the Instagram credentials are missing. */
  instagram?: InstagramPort | undefined;
  dirs: { state: string; out: string; cache: string; photos: string };
  /** Where Playwright keeps its browsers. */
  browserCacheDir: string;
  /** The GitHub Pages index the image host serves from. */
  pagesUrl?: string | undefined;
  /** Defaults to the real filesystem. */
  fs?: DoctorFs | undefined;
};

export const REQUIRED_ENV = [
  "IG_USER_ID",
  "IG_ACCESS_TOKEN",
  "DISCORD_BOT_TOKEN",
  "DISCORD_APPROVAL_CHANNEL_ID",
] as const;

export const OPTIONAL_ENV = ["META_APP_ID", "META_APP_SECRET"] as const;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function check(name: string, probe: () => Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, detail: await probe() };
  } catch (error) {
    return { name, ok: false, detail: messageOf(error) };
  }
}

/** Every check, in the order they are printed. Never throws. */
export async function doctor(env: Env, deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const files = deps.fs ?? nodeFs;

  checks.push(
    await check(".env", async () => {
      const missing = REQUIRED_ENV.filter((key) => !env[key]);
      if (missing.length > 0) throw new Error(`missing ${missing.join(", ")} — see docs/setup/accounts-and-keys.md`);
      const optional = OPTIONAL_ENV.filter((key) => !env[key]);
      return optional.length > 0
        ? `all required keys present (${optional.join(", ")} not set; needed only for token refresh)`
        : "all keys present";
    }),
  );

  const baseUrl = (env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:18085/v1").replace(/\/$/, "");
  const wantedModel = env.LOCAL_LLM_MODEL;
  checks.push(
    await check("model server", async () => {
      const response = await deps.fetch(`${baseUrl}/models`);
      if (!response.ok) throw new Error(`${baseUrl}/models returned ${response.status}`);
      const body = (await response.json()) as { data?: { id?: string }[] };
      const ids = (body.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
      if (ids.length === 0) throw new Error(`${baseUrl}/models listed no models`);
      if (wantedModel && !ids.includes(wantedModel)) {
        throw new Error(`${wantedModel} is not loaded; server has ${ids.join(", ")}`);
      }
      return `${baseUrl} serving ${wantedModel ?? ids[0]}`;
    }),
  );

  checks.push(
    await check("qwen cli", async () => {
      const { code, stdout, stderr } = await deps.run(["qwen", "--version"]);
      if (code !== 0) throw new Error(`qwen --version exited ${code}: ${stderr.trim() || stdout.trim()}`);
      return stdout.trim() || "installed";
    }),
  );

  const instagram = deps.instagram;
  checks.push(
    await check("instagram account", async () => {
      if (!instagram) throw new Error("no Instagram credentials to test");
      const me = await instagram.me();
      return `@${me.username} (${me.id})`;
    }),
  );

  checks.push(
    await check("instagram quota", async () => {
      if (!instagram) throw new Error("no Instagram credentials to test");
      const { used, total } = await instagram.quota();
      return `${used} of ${total} posts used in the last 24h`;
    }),
  );

  checks.push(
    await check("discord channel", async () => {
      const token = env.DISCORD_BOT_TOKEN;
      const channelId = env.DISCORD_APPROVAL_CHANNEL_ID;
      if (!token || !channelId) throw new Error("no Discord credentials to test");
      const response = await deps.fetch(`https://discord.com/api/v10/channels/${channelId}`, {
        headers: { Authorization: `Bot ${token}` },
      });
      if (!response.ok) {
        throw new Error(
          `GET /channels/${channelId} returned ${response.status} — is the bot in the server and can it see the channel?`,
        );
      }
      const body = (await response.json()) as { name?: string };
      return `#${body.name ?? channelId} readable`;
    }),
  );

  checks.push(
    await check("pages site", async () => {
      const url = deps.pagesUrl;
      if (!url) throw new Error("PAGES_URL is not set");
      const response = await deps.fetch(url);
      if (response.status !== 200) throw new Error(`${url} returned ${response.status}`);
      return `${url} returns 200`;
    }),
  );

  checks.push(
    await check("chromium", async () => {
      const entries = await files.listDir(deps.browserCacheDir);
      const found = entries.filter((name) => name.startsWith("chromium"));
      if (found.length === 0) {
        throw new Error(`no chromium-* in ${deps.browserCacheDir} — run \`pnpm exec playwright install chromium\``);
      }
      return found.join(", ");
    }),
  );

  checks.push(
    await check("directories", async () => {
      const notes: string[] = [];
      for (const [name, path] of Object.entries(deps.dirs)) {
        notes.push(`${name} ${await files.ensureDir(path)}`);
      }
      return notes.join(", ");
    }),
  );

  return checks;
}

export const nodeFs: DoctorFs = {
  async ensureDir(path) {
    try {
      await access(path);
      return "exists";
    } catch {
      await mkdir(path, { recursive: true });
      return "created";
    }
  },
  async listDir(path) {
    return readdir(path);
  },
};

/** Runs a command and captures its output. Never throws. */
export const runCommand: RunCommand = (argv) =>
  new Promise((resolve) => {
    const [command, ...args] = argv;
    if (!command) {
      resolve({ code: 127, stdout: "", stderr: "empty command" });
      return;
    }
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** The checkup as a table, one line per check. */
export function formatChecks(checks: Check[]): string {
  const width = Math.max(...checks.map((c) => c.name.length), 4);
  const lines = checks.map((c) => `${c.ok ? "✓" : "✗"}  ${c.name.padEnd(width)}  ${c.detail}`);
  const bad = checks.filter((c) => !c.ok).length;
  lines.push("");
  lines.push(bad === 0 ? "All checks passed." : `${bad} of ${checks.length} checks failed.`);
  return lines.join("\n");
}
