import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchProviderError, searchSource } from "@/lib/search/tavily";

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
function sentBody(fn: ReturnType<typeof mockFetch>) {
  const calls = fn.mock.calls as unknown as [string, RequestInit][];
  return JSON.parse(calls[0][1].body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("searchSource", () => {
  it("maps source to include_domains", async () => {
    const expected = {
      x: ["x.com", "twitter.com"],
      linkedin: ["linkedin.com"],
      threads: ["threads.net", "threads.com"],
    } as const;
    for (const [source, domains] of Object.entries(expected)) {
      const fn = mockFetch(200, { results: [] });
      await searchSource(source as keyof typeof expected, "writer");
      const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.tavily.com/search");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-search-key");
      const body = sentBody(fn);
      expect(body.include_domains).toEqual(domains);
      expect(body.search_depth).toBe("basic");
      expect(body.query).toBe("writer");
      expect(JSON.stringify(body)).not.toContain("test-search-key");
    }
  });

  it("normalizes results to SearchHit", async () => {
    mockFetch(200, {
      results: [
        { url: "https://x.com/a", title: "A", content: "c".repeat(800) },
        { title: "no url", content: "x" },
        { url: "https://x.com/b", title: "B", content: "short" },
      ],
    });
    const hits = await searchSource("x", "q");
    expect(hits).toEqual([
      { source: "x", url: "https://x.com/a", title: "A", snippet: "c".repeat(500) },
      { source: "x", url: "https://x.com/b", title: "B", snippet: "short" },
    ]);
  });

  it("clamps limit to 1..20", async () => {
    let fn = mockFetch(200, { results: [] });
    await searchSource("x", "q", 999);
    expect(sentBody(fn).max_results).toBe(20);
    fn = mockFetch(200, { results: [] });
    await searchSource("x", "q", 0);
    expect(sentBody(fn).max_results).toBe(1);
    fn = mockFetch(200, { results: [] });
    await searchSource("x", "q");
    expect(sentBody(fn).max_results).toBe(10);
  });

  it("non-200 throws SearchProviderError with status only", async () => {
    mockFetch(429, { detail: "secret upstream body test-search-key" });
    const err = await searchSource("x", "q").catch((e) => e);
    expect(err).toBeInstanceOf(SearchProviderError);
    expect(err.status).toBe(429);
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("test-search-key");
  });
});
