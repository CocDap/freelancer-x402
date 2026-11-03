"use server";

import { requireUser } from "@/lib/auth";
import { runFreelancerSearch } from "@/lib/agent/find-freelancers";
import { briefSchema } from "@/lib/agent/schema";
import type { SearchState } from "./state";

const FIELDS = ["topic", "contentType", "language", "tone", "budgetUsdc", "deadline"] as const;
const MESSAGES: Record<(typeof FIELDS)[number], string> = {
  topic: "Chủ đề phải dài từ 1 đến 500 ký tự.",
  contentType: "Vui lòng nhập loại nội dung (tối đa 100 ký tự).",
  language: "Vui lòng nhập ngôn ngữ (tối đa 50 ký tự).",
  tone: "Giọng văn tối đa 100 ký tự.",
  budgetUsdc: "Ngân sách phải là số dương.",
  deadline: "Hạn tối đa 100 ký tự.",
};

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function searchAction(_prev: SearchState, formData: FormData): Promise<SearchState> {
  const user = await requireUser();
  const values = Object.fromEntries(FIELDS.map((k) => [k, str(formData, k)]));

  const budget = values.budgetUsdc === "" ? undefined : Number(values.budgetUsdc);
  const parsed = briefSchema.safeParse({
    topic: values.topic,
    contentType: values.contentType,
    language: values.language,
    tone: values.tone || undefined,
    budgetUsdc: budget,
    deadline: values.deadline || undefined,
  });
  if (!parsed.success) {
    const fieldErrors: NonNullable<SearchState["fieldErrors"]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as (typeof FIELDS)[number];
      if (FIELDS.includes(key)) fieldErrors[key] = MESSAGES[key];
    }
    return { fieldErrors, values };
  }

  try {
    const result = await runFreelancerSearch(user.id, parsed.data);
    return { result, values };
  } catch (e) {
    console.error("[search] run failed:", e instanceof Error ? `${e.name}: ${e.message}` : "unknown");
    return { error: "Không thể chạy tìm kiếm lúc này. Vui lòng thử lại sau.", values };
  }
}
