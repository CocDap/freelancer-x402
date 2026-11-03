import { getEnv } from "@/lib/env";

export type Source = "x" | "linkedin" | "threads";
export type SearchHit = { source: Source; url: string; title: string; snippet: string };

export const SOURCES: readonly Source[] = ["x", "linkedin", "threads"];

export function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

const INCLUDE_DOMAINS: Record<Source, string[]> = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  threads: ["threads.net", "threads.com"],
};

const TAVILY_URL = "https://api.tavily.com/search";
const SNIPPET_MAX = 500;

/** Carries only the upstream HTTP status; never the upstream body or the API key. */
export class SearchProviderError extends Error {
  constructor(readonly status: number) {
    super(`Search provider responded with status ${status}`);
    this.name = "SearchProviderError";
  }
}

type TavilyResult = { url?: unknown; title?: unknown; content?: unknown };

export async function searchSource(source: Source, query: string, limit = 10): Promise<SearchHit[]> {
  const env = getEnv();
  if (env.SEARCH_PROVIDER !== "tavily") throw new Error(`Unsupported SEARCH_PROVIDER: ${env.SEARCH_PROVIDER}`);

  const maxResults = Math.min(20, Math.max(1, Math.trunc(limit) || 1));
  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SEARCH_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: maxResults,
      include_domains: INCLUDE_DOMAINS[source],
    }),
  });
  if (res.status !== 200) throw new SearchProviderError(res.status);

  const data = (await res.json()) as { results?: TavilyResult[] };
  const hits: SearchHit[] = [];
  for (const r of data.results ?? []) {
    if (typeof r.url !== "string" || !r.url) continue;
    hits.push({
      source,
      url: r.url,
      title: typeof r.title === "string" ? r.title : "",
      snippet: (typeof r.content === "string" ? r.content : "").slice(0, SNIPPET_MAX),
    });
  }
  return hits;
}
