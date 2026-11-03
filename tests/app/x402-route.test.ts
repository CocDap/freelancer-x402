import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/chain/clients", () => ({
  getPublicClient: async () => ({
    readContract: async ({ functionName }: { functionName: string }) =>
      functionName === "name" ? "USD Coin" : "2",
  }),
}));

const realFetch = globalThis.fetch;
const facilitatorCalls: string[] = [];
const tavilyCalls: string[] = [];
let tavilyStatus = 200;

beforeEach(() => {
  facilitatorCalls.length = 0;
  tavilyCalls.length = 0;
  tavilyStatus = 200;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("facilitator.payai.network")) {
      facilitatorCalls.push(url);
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:43113" }],
        extensions: [],
        signers: {},
      });
    }
    if (url.includes("tavily")) {
      tavilyCalls.push(url);
      return new Response(JSON.stringify({ detail: "boom test-search-key" }), { status: tavilyStatus });
    }
    throw new Error(`unexpected network call: ${url}`);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = realFetch;
});

import { GET } from "@/app/api/x402/search/[source]/route";

const call = (source: string, qs: string) =>
  GET(new NextRequest(`http://localhost:3000/api/x402/search/${source}${qs}`), {
    params: Promise.resolve({ source }),
  });

describe("GET /api/x402/search/[source]", () => {
  it("request without payment -> 402 with accepts[0] on Fuji", async () => {
    const res = await call("x", "?q=test");
    expect(res.status).toBe(402);
    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:43113",
      payTo: "0x0000000000000000000000000000000000000001",
      asset: "0x5425890298aed601595a70AB815c96711a31Bc65",
      amount: "10000",
      extra: { name: "USD Coin", version: "2" },
    });
    expect(tavilyCalls).toHaveLength(0);
  });

  it("402 also for linkedin and threads", async () => {
    expect((await call("linkedin", "?q=test")).status).toBe(402);
    expect((await call("threads", "?q=test")).status).toBe(402);
  });

  it("invalid source -> 400 (never asks payment)", async () => {
    const res = await call("facebook", "?q=test");
    expect(res.status).toBe(400);
    expect(facilitatorCalls).toHaveLength(0);
  });

  it("missing/blank/too-long q -> 400", async () => {
    expect((await call("x", "")).status).toBe(400);
    expect((await call("x", "?q=%20%20")).status).toBe(400);
    expect((await call("x", `?q=${"a".repeat(201)}`)).status).toBe(400);
  });
});

import { searchHandler } from "@/lib/search/handler";

describe("paid inner handler", () => {
  it("Tavily failure -> 502 Vietnamese message, no upstream body/key leaked", async () => {
    tavilyStatus = 500;
    const res = await searchHandler(new NextRequest("http://localhost:3000/api/x402/search/x?q=test"));
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Nguồn tìm kiếm lỗi, thử lại sau." });
    expect(text).not.toContain("test-search-key");
    expect(text).not.toContain("boom");
  });
});
