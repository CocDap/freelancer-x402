import type { Candidate } from "@/lib/agent/schema";

export type SearchState = {
  error?: string;
  fieldErrors?: Partial<Record<"topic" | "contentType" | "language" | "tone" | "budgetUsdc" | "deadline", string>>;
  values?: Record<string, string>;
  result?: { searchId: string; candidates: Candidate[]; spentUsdc: number; warnings: string[] };
};
