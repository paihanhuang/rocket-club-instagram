import { z } from "zod";
import { PILLARS } from "./types.js";

/** The writer's contract. Also exported as JSON Schema for qwen code's --json-schema. */
export const draftTextSchema = z.object({
  headline: z.string().min(8).max(90),
  slides: z
    .array(z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(320) }))
    .min(1)
    .max(10),
  caption: z.string().min(40).max(1800),
  sourceLine: z.string().min(6).max(200),
  hashtags: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(5).max(8),
  flags: z.array(z.string().min(1).max(120)).max(10),
});
export type DraftTextInput = z.input<typeof draftTextSchema>;

export const assignmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pillar: z.enum(PILLARS),
  angle: z.string().min(1).max(300),
});

export const verdictSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  by: z.string(),
  at: z.string(),
  contentHash: z.string(),
});

export const draftSchema = z.object({
  id: z.string(),
  assignment: assignmentSchema,
  text: draftTextSchema,
  slides: z.array(z.object({ path: z.string(), width: z.number(), height: z.number() })),
  photo: z
    .object({ url: z.string(), license: z.string(), credit: z.string(), source: z.string(), path: z.string() })
    .optional(),
  contentHash: z.string(),
  createdAt: z.string(),
  publishBy: z.string(),
  status: z.enum(["pending", "approved", "rejected", "expired", "publishing", "published", "failed"]),
  discordMessageId: z.string().optional(),
  verdict: verdictSchema.optional(),
  publish: z
    .object({
      imageUrls: z.array(z.string()),
      containerIds: z.array(z.string()),
      carouselId: z.string().optional(),
      mediaId: z.string().optional(),
      permalink: z.string().optional(),
    })
    .optional(),
  error: z.string().optional(),
});
