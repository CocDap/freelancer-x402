import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address } from "viem";
import { encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { createDb, type Db } from "@/lib/db/client";
import { x402Payment } from "@/lib/db/schema";
import { BudgetExceededError, createPayingFetch } from "@/lib/x402/client";

const NETWORK = "eip155:43113";
const ASSET = "0x5425890298aed601595a70AB815c96711a31Bc65" as Address;
const PAY_TO = "0x000000000000000000000000000000000000dEaD" as Address;
const URL_ = "http://seller.test/api/x402/search/linkedin?q=x";

type Accept = { scheme: string; network: string; asset: string; amount: string; payTo: string };
const accept = (over: Partial<Accept> = {}): Accept => ({
  scheme: "exact",
  network: NETWORK,
  asset: ASSET,
  amount: "10000",
  payTo: PAY_TO,
  ...over,
});

/** Hand-rolled seller: 402 without a payment-signature header, 200 + payment-response with one. */
function stubSeller(opts: { accepts?: Accept[]; settle?: "ok" | "fail" | "missing" | "garbage"; status?: number; after?: "throw" | "402" } = {}) {
  const accepts = (opts.accepts ?? [accept()]).map((a) => ({
    ...a,
    maxTimeoutSeconds: 60,
    extra: { name: "USD Coin", version: "2" },
  }));
  const calls = vi.fn();
  vi.stubGlobal("fetch", async (input: Request | string) => {
    const req = input instanceof Request ? input : new Request(input);
    calls();
    await Promise.resolve();
    if (!req.headers.get("payment-signature")) {
      const pr = { x402Version: 2, error: "payment required", resource: { url: req.url }, accepts };
      return new Response("{}", {
        status: 402,
        headers: { "payment-required": encodePaymentRequiredHeader(pr as never), "content-type": "application/json" },
      });
    }
    if (opts.after === "throw") throw new Error("network down");
    if (opts.after === "402") {
      const pr = { x402Version: 2, error: "invalid payment", resource: { url: req.url }, accepts };
      return new Response("{}", { status: 402, headers: { "payment-required": encodePaymentRequiredHeader(pr as never) } });
    }
    const headers: Record<string, string> = {};
    const mode = opts.settle ?? "ok";
    if (mode === "ok" || mode === "fail") {
      headers["payment-response"] = encodePaymentResponseHeader({
        success: mode === "ok",
        transaction: mode === "ok" ? "0xabc123" : "",
        network: NETWORK,
        payer: "0x0000000000000000000000000000000000000001",
      } as never);
    } else if (mode === "garbage") {
      headers["payment-response"] = "%%%not-base64-json";
    }
    return new Response(JSON.stringify({ hits: [] }), { status: opts.status ?? 200, headers });
  });
  return calls;
}

let db: Db;
const account = privateKeyToAccount(generatePrivateKey());
let signSpy: ReturnType<typeof vi.spyOn>;

const make = (over: Partial<Parameters<typeof createPayingFetch>[0]> = {}) =>
  createPayingFetch({
    account,
    searchId: "s1",
    maxPerCallUsdc: 0.05,
    maxPerSearchUsdc: 0.5,
    network: NETWORK,
    asset: ASSET,
    database: db,
    ...over,
  });

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  signSpy = vi.spyOn(account, "signTypedData");
});
afterEach(() => {
  vi.unstubAllGlobals();
  signSpy.mockRestore();
});

const rows = () => db.select().from(x402Payment);

describe("createPayingFetch", () => {
  it("pays once and returns body", async () => {
    stubSeller();
    const p = make();
    const res = await p.fetch(URL_);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: [] });
    expect(p.spentUsdc()).toBe(0.01);
    expect(signSpy).toHaveBeenCalledTimes(1);
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ searchId: "s1", amountUsdc: 0.01, txHash: "0xabc123", url: "http://seller.test/api/x402/search/linkedin" });
  });

  it("rejects price above per-call cap without signing", async () => {
    stubSeller({ accepts: [accept({ amount: "60000" })] });
    const p = make();
    const err = await p.fetch(URL_).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.reason).toBe("per_call");
    expect(signSpy).not.toHaveBeenCalled();
    expect(p.spentUsdc()).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it("stops when cumulative would exceed per-search cap", async () => {
    stubSeller();
    const p = make({ maxPerSearchUsdc: 0.02 });
    await p.fetch(URL_);
    await p.fetch(URL_);
    signSpy.mockClear();
    const err = await p.fetch(URL_).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.reason).toBe("per_search");
    expect(signSpy).not.toHaveBeenCalled();
    expect(p.spentUsdc()).toBe(0.02);
  });

  it.each([
    ["network", { network: "eip155:1" }],
    ["asset", { asset: "0x0000000000000000000000000000000000000001" }],
    ["pay_to", { payTo: "0x0000000000000000000000000000000000000002" }],
    ["scheme", { scheme: "upto" }],
  ] as const)("rejects wrong %s without signing", async (reason, over) => {
    stubSeller({ accepts: [accept(over)] });
    const p = make({ payTo: PAY_TO });
    const err = await p.fetch(URL_).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err.reason).toBe(reason);
    expect(signSpy).not.toHaveBeenCalled();
  });

  it("accepts asset address case-insensitively", async () => {
    stubSeller({ accepts: [accept({ asset: ASSET.toLowerCase() })] });
    const p = make();
    expect((await p.fetch(URL_)).status).toBe(200);
  });

  it("parallel calls cannot exceed per-search cap", async () => {
    stubSeller();
    const p = make({ maxPerSearchUsdc: 0.02 });
    const results = await Promise.allSettled([p.fetch(URL_), p.fetch(URL_), p.fetch(URL_), p.fetch(URL_)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(2);
    expect(bad).toHaveLength(2);
    for (const b of bad) expect((b as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError);
    expect(p.spentUsdc()).toBe(0.02);
    expect(signSpy).toHaveBeenCalledTimes(2);
    expect(await rows()).toHaveLength(2);
  });

  it.each(["fail", "missing", "garbage"] as const)("no row but spend counted when settlement is %s", async (settle) => {
    stubSeller({ settle });
    const p = make();
    await p.fetch(URL_);
    expect(p.spentUsdc()).toBe(0.01);
    expect(await rows()).toHaveLength(0);
  });

  it("counts a settled-but-non-OK response without a row", async () => {
    stubSeller({ settle: "ok", status: 502 });
    const p = make();
    const res = await p.fetch(URL_);
    expect(res.status).toBe(502);
    expect(p.spentUsdc()).toBe(0.01);
    expect(await rows()).toHaveLength(0);
  });

  it("explicit 402 after payment releases the reservation", async () => {
    stubSeller({ after: "402" });
    const p = make({ maxPerSearchUsdc: 0.01 });
    const res = await p.fetch(URL_);
    expect(res.status).toBe(402);
    expect(p.spentUsdc()).toBe(0);
    stubSeller();
    expect((await p.fetch(URL_)).status).toBe(200);
  });

  it("thrown error after signing keeps amount counted", async () => {
    stubSeller({ after: "throw" });
    const p = make({ maxPerSearchUsdc: 0.01 });
    await expect(p.fetch(URL_)).rejects.toThrow("network down");
    expect(p.spentUsdc()).toBe(0.01);
    stubSeller();
    const err = await p.fetch(URL_).catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(await rows()).toHaveLength(0);
  });

  it("failure before signing releases the reservation", async () => {
    stubSeller();
    const p = make({ maxPerSearchUsdc: 0.01 });
    signSpy.mockRejectedValueOnce(new Error("hsm down"));
    await expect(p.fetch(URL_)).rejects.toThrow();
    expect(p.spentUsdc()).toBe(0);
    expect((await p.fetch(URL_)).status).toBe(200);
    expect(p.spentUsdc()).toBe(0.01);
  });

  it("db insert failure still returns the response and keeps spend", async () => {
    stubSeller();
    const broken = { insert: () => { throw new Error("db down"); } } as unknown as Db;
    const p = make({ database: broken });
    const res = await p.fetch(URL_);
    expect(res.status).toBe(200);
    expect(p.spentUsdc()).toBe(0.01);
  });
});
