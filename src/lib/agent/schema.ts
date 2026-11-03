import { z } from "zod";
import { SOURCES } from "@/lib/search/tavily";

export const briefSchema = z.object({
  topic: z.string().trim().min(1).max(500),
  contentType: z.string().trim().min(1).max(100),
  language: z.string().trim().min(1).max(50),
  tone: z.string().trim().max(100).optional(),
  budgetUsdc: z.number().positive().max(1_000_000).optional(),
  deadline: z.string().trim().max(100).optional(),
});
export type Brief = z.infer<typeof briefSchema>;

export const candidateSchema = z.object({
  name: z.string(),
  handle: z.string().optional(),
  profileUrl: z.string(),
  sampleUrls: z.array(z.string()),
  source: z.enum(SOURCES as [string, ...string[]]) as z.ZodType<"x" | "linkedin" | "threads">,
  fitReason: z.string(),
  risks: z.array(z.string()),
});
export type Candidate = z.infer<typeof candidateSchema>;

/** Shape the model must produce in the structured-output step. */
export const agentOutputSchema = z.object({ candidates: z.array(candidateSchema) });
