import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { keccak256, parseUnits, toBytes, zeroHash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { setupAnvil } from "../setup/chain";
import { createDb, type Db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { createUserWallet } from "@/lib/wallet/user-wallet";
import { createJob } from "@/lib/escrow/relay";
import { getJob } from "@/lib/escrow/read";
import { ACTION_TYPES, ActionKind, actionMessage, escrowDomain } from "@/lib/escrow/typed-data";

// The route uses the default db; point it at a fresh in-memory db per test.
const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/client")>()),
  getDb: () => holder.db,
}));

import { POST } from "@/app/api/public/jobs/[jobId]/route";

const DAY = 86_400;
const chain = setupAnvil();
let db: Db;

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  holder.db = db;
});

let seq = 0;
async function newJob(): Promise<{ jobId: Hex; freelancer: PrivateKeyAccount }> {
  const userId = `pub-buyer-${++seq}-${Date.now()}`;
  const address = await createUserWallet(userId, db);
  await chain.mintUsdc(address, parseUnits("100", 6));
  const freelancer = privateKeyToAccount(generatePrivateKey());
  const now = Number(await chain.latestTimestamp());
  const { jobId } = await createJob(
    userId,
    {
      freelancer: freelancer.address,
      amountUsdc: "10",
      deliverDeadline: new Date((now + 5 * DAY) * 1000),
      reviewDays: 7,
      revisionDays: 3,
      maxRevisions: 2,
    },
    { db },
  );
  return { jobId, freelancer };
}

async function sign(signer: PrivateKeyAccount, jobId: Hex, kind: number, data: Hex) {
  const view = await getJob(jobId);
  const deadline = (await chain.latestTimestamp()) + 600n;
  const sig = await signer.signTypedData({
    domain: escrowDomain(chain.ctx.chainId, chain.ctx.escrow),
    types: ACTION_TYPES,
    primaryType: "Action",
    message: actionMessage(jobId, kind, data, view.actionNonce, deadline),
  });
  return { sig, deadline: deadline.toString() };
}

function call(jobId: string, body: unknown) {
  return POST(
    new Request("http://localhost/api/public/jobs/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) },
  );
}

const url = "https://example.com/delivery";

describe("POST /api/public/jobs/[jobId]", () => {
  it("submit with valid freelancer sig -> 200 and state Submitted", async () => {
    const { jobId, freelancer } = await newJob();
    const { sig, deadline } = await sign(freelancer, jobId, ActionKind.Submit, keccak256(toBytes(url)));
    const res = await call(jobId, { kind: "submit", contentUrl: url, deadline, sig });
    expect(res.status).toBe(200);
    expect((await res.json()).txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect((await getJob(jobId)).stateName).toBe("Submitted");
    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row.contentUrl).toBe(url);
  });

  it("submit signed by non-freelancer -> 409 and contentUrl is not stored", async () => {
    const { jobId } = await newJob();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const { sig, deadline } = await sign(stranger, jobId, ActionKind.Submit, keccak256(toBytes(url)));
    const res = await call(jobId, { kind: "submit", contentUrl: url, deadline, sig });
    expect(res.status).toBe(409);
    expect(typeof (await res.json()).error).toBe("string");
    expect((await getJob(jobId)).stateName).toBe("Funded");
    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row.contentUrl).toBeNull();
  });

  it("invalid signature never overwrites an existing contentUrl", async () => {
    const { jobId, freelancer } = await newJob();
    const first = await sign(freelancer, jobId, ActionKind.Submit, keccak256(toBytes(url)));
    expect((await call(jobId, { kind: "submit", contentUrl: url, deadline: first.deadline, sig: first.sig })).status).toBe(200);
    const evil = "https://evil.example/x";
    const stranger = privateKeyToAccount(generatePrivateKey());
    const bad = await sign(stranger, jobId, ActionKind.Submit, keccak256(toBytes(evil)));
    const res = await call(jobId, { kind: "submit", contentUrl: evil, deadline: bad.deadline, sig: bad.sig });
    expect(res.status).toBe(409);
    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row.contentUrl).toBe(url);
  });

  it("contentUrl not http(s) -> 400", async () => {
    const { jobId, freelancer } = await newJob();
    for (const bad of ["javascript:alert(1)", "ftp://x.com/a", "not a url", "https://x.com/" + "a".repeat(2100)]) {
      const { sig, deadline } = await sign(freelancer, jobId, ActionKind.Submit, keccak256(toBytes(bad)));
      const res = await call(jobId, { kind: "submit", contentUrl: bad, deadline, sig });
      expect(res.status).toBe(400);
    }
    expect((await getJob(jobId)).stateName).toBe("Funded");
  });

  it("job with no row in this app -> 404 for submit, decline and finalize, nothing relayed", async () => {
    const { jobId, freelancer } = await newJob();
    await db.delete(job).where(eq(job.id, jobId));
    const s = await sign(freelancer, jobId, ActionKind.Submit, keccak256(toBytes(url)));
    const res = await call(jobId, { kind: "submit", contentUrl: url, deadline: s.deadline, sig: s.sig });
    expect(res.status).toBe(404);
    expect(typeof (await res.json()).error).toBe("string");
    const d = await sign(freelancer, jobId, ActionKind.Decline, zeroHash);
    expect((await call(jobId, { kind: "decline", deadline: d.deadline, sig: d.sig })).status).toBe(404);
    expect((await call(jobId, { kind: "finalize" })).status).toBe(404);
    expect((await getJob(jobId)).stateName).toBe("Funded");
  });

  it("bad jobId or malformed body -> 400", async () => {
    expect((await call("0x1234", { kind: "finalize" })).status).toBe(400);
    expect((await call("nope", { kind: "finalize" })).status).toBe(400);
    const { jobId } = await newJob();
    expect((await call(jobId, { kind: "bogus" })).status).toBe(400);
    expect((await call(jobId, { kind: "submit", deadline: "1", sig: "0x12" })).status).toBe(400);
    expect((await call(jobId, { kind: "submit", contentUrl: url, deadline: "abc", sig: "0x12" })).status).toBe(400);
  });

  it("decline with valid sig -> 200 (no contentUrl needed)", async () => {
    const { jobId, freelancer } = await newJob();
    const { sig, deadline } = await sign(freelancer, jobId, ActionKind.Decline, zeroHash);
    const res = await call(jobId, { kind: "decline", deadline, sig });
    expect(res.status).toBe(200);
    expect((await getJob(jobId)).stateName).toBe("Refunded");
  });

  it("finalize before deadline -> 409", async () => {
    const { jobId, freelancer } = await newJob();
    const { sig, deadline } = await sign(freelancer, jobId, ActionKind.Submit, keccak256(toBytes(url)));
    expect((await call(jobId, { kind: "submit", contentUrl: url, deadline, sig })).status).toBe(200);
    const res = await call(jobId, { kind: "finalize" });
    expect(res.status).toBe(409);
    expect(typeof (await res.json()).error).toBe("string");
  });
});
