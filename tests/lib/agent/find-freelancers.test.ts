import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { MockLanguageModelV4 } from "ai/test";
import { createDb, type Db } from "@/lib/db/client";
import { search } from "@/lib/db/schema";
import { createUserWallet } from "@/lib/wallet/user-wallet";
import { BudgetExceededError } from "@/lib/x402/client";
import { normalizeUrl, runFreelancerSearch } from "@/lib/agent/find-freelancers";
import type { Brief } from "@/lib/agent/schema";

const BRIEF: Brief = { topic: "crypto blog", contentType: "bài blog", language: "vi" };
const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const toolCall = (name: string, query: string, id = "c1") => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName: name, input: JSON.stringify({ query }) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const text = (t: string) => ({
  content: [{ type: "text" as const, text: t }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage: USAGE,
  warnings: [],
});
const cand = (over: Record<string, unknown> = {}) => ({
  name: "Alice",
  profileUrl: "https://x.com/alice",
  sampleUrls: [],
  source: "x",
  fitReason: "Viết tốt",
  risks: [],
  ...over,
});
const output = (candidates: unknown[]) => text(JSON.stringify({ candidates }));
const hitsFetch = (hits: object[]) => async () => Response.json({ hits });
const HIT = { source: "x", url: "https://x.com/alice", title: "Alice", snippet: "writer" };

let db: Db;
beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await createUserWallet("u1", db);
});

describe("normalizeUrl", () => {
  it("ignores www, trailing slash, query, hash, case and scheme", () => {
    const a = normalizeUrl("https://www.X.com/Alice/?s=1#top");
    expect(a).toBe(normalizeUrl("http://x.com/alice"));
    expect(a).not.toBe(normalizeUrl("https://evil.com/alice"));
  });
  it("returns null for non-http or garbage", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("runFreelancerSearch", () => {
  it("returns candidates only with urls seen in hits", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("search_x", "crypto writer"),
        text("done"),
        output([
          cand({ profileUrl: "https://www.x.com/alice/", sampleUrls: ["https://x.com/alice?ref=1", "https://evil.com/p"] }),
          cand({ name: "Bob", profileUrl: "https://evil.com/bob" }),
        ]),
      ],
    });
    const r = await runFreelancerSearch("u1", BRIEF, { model, fetch: hitsFetch([HIT]), database: db });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].name).toBe("Alice");
    expect(r.candidates[0].profileUrl).toBe("https://x.com/alice");
    expect(r.candidates[0].sampleUrls).toEqual(["https://x.com/alice"]);
    const [row] = await db.select().from(search);
    expect(row.id).toBe(r.searchId);
    expect(row.userId).toBe("u1");
  });

  it("dedupes by profileUrl", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("search_x", "q"),
        text("done"),
        output([cand(), cand({ profileUrl: "https://x.com/alice/" })]),
      ],
    });
    const r = await runFreelancerSearch("u1", BRIEF, { model, fetch: hitsFetch([HIT]), database: db });
    expect(r.candidates).toHaveLength(1);
  });

  it("budget exceeded mid-run returns partial results with warning", async () => {
    let n = 0;
    const fetchFn = async () => {
      if (++n === 1) return Response.json({ hits: [HIT] });
      throw new BudgetExceededError("per_search");
    };
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCall("search_x", "q1", "c1"),
        toolCall("search_linkedin", "q2", "c2"),
        output([cand()]),
      ],
    });
    const r = await runFreelancerSearch("u1", BRIEF, { model, fetch: fetchFn, database: db });
    expect(r.candidates).toHaveLength(1);
    expect(r.warnings).toContain("Đã chạm giới hạn chi tiêu cho lần tìm này.");
    expect(n).toBe(2);
    expect(model.doGenerateCalls).toHaveLength(3); // 2 tool steps + final structured step; no further tool step
  });

  it("LLM error returns empty candidates with warning, spent recorded", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("boom sk-secret");
      },
    });
    const r = await runFreelancerSearch("u1", BRIEF, {
      model,
      fetch: hitsFetch([]),
      spentUsdc: () => 0.02,
      database: db,
    });
    expect(r.candidates).toEqual([]);
    expect(r.warnings).toContain("Mô hình AI lỗi, thử lại sau.");
    expect(JSON.stringify(r)).not.toContain("sk-secret");
    const [row] = await db.select().from(search);
    expect(row.spentUsdc).toBe(0.02);
    expect(row.candidates).toEqual([]);
    expect(row.warnings).toContain("Mô hình AI lỗi, thử lại sau.");
  });

  it("truncates the query to 200 chars and returns non-2xx as a tool error, not a throw", async () => {
    const urls: string[] = [];
    const fetchFn = async (u: RequestInfo | URL) => {
      urls.push(String(u));
      return new Response("secret provider body", { status: 502 });
    };
    const model = new MockLanguageModelV4({
      doGenerate: [toolCall("search_x", "  " + "a".repeat(300)), text("done")],
    });
    const r = await runFreelancerSearch("u1", BRIEF, { model, fetch: fetchFn, database: db });
    expect(new URL(urls[0]).searchParams.get("q")).toHaveLength(200);
    expect(r.candidates).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(JSON.stringify(model.doGenerateCalls)).not.toContain("secret provider body");
    expect(JSON.stringify(r)).not.toContain("secret provider body");
  });
});
