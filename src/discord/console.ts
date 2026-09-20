/**
 * A stand-in for Discord used before the bot exists (dry runs, the gate):
 * writes each card to a Markdown file and prints notices. Never approves.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiscordPort } from "../newsroom/ports.js";
import type { Draft, Slide, Verdict } from "../newsroom/types.js";
import { buildCardContent } from "./index.js";

export function createConsoleDiscord(cfg: { outDir: string; log?: (line: string) => void }): DiscordPort {
  const log = cfg.log ?? ((line: string) => console.log(line));
  return {
    async postDraft(draft: Draft, slides: Slide[]): Promise<{ messageId: string }> {
      await mkdir(cfg.outDir, { recursive: true });
      const file = join(cfg.outDir, `${draft.id}.md`);
      const body = `${buildCardContent(draft)}\n\nslides:\n${slides.map((s) => `- ${s.path}`).join("\n")}\n`;
      await writeFile(file, body);
      log(`[console] card written to ${file}`);
      return { messageId: `console-${draft.id}` };
    },
    async readVerdict(): Promise<Verdict | undefined> {
      return undefined;
    },
    async notify(text: string): Promise<void> {
      log(`[console] ${text}`);
    },
  };
}
