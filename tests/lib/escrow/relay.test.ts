import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import {
  createWalletClient,
  domainSeparator,
  http,
  parseEther,
  parseUnits,
  zeroHash,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { setupAnvil } from "../../setup/chain";
import { createDb, type Db } from "@/lib/db/client";
import { job } from "@/lib/db/schema";
import { createUserWallet } from "@/lib/wallet/user-wallet";
import { escrowAbi } from "@/lib/chain/escrow-abi";
import { ACTION_TYPES, ActionKind, actionMessage, escrowDomain } from "@/lib/escrow/typed-data";
import { TermsError, jobNonce, newJobId, toTerms, type JobTermsInput } from "@/lib/escrow/terms";
import {
  ChainActionError,
  InsufficientUsdcError,
  RelayerUnderfundedError,
  buyerAction,
  createJob,
  finalize,
  relayFreelancerAction,
} from "@/lib/escrow/relay";
import { getJob } from "@/lib/escrow/read";

const DAY = 86_400;
const chain = setupAnvil();
let db: Db;

beforeAll(async () => {
  // sanity: the deployed escrow answers
  expect(await chain.publicClient.getCode({ address: chain.ctx.escrow })).toBeTruthy();
});

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});

let userSeq = 0;
async function newBuyer(usdc = "100") {
  const userId = `buyer-${++userSeq}-${Date.now()}`;
  const address = await createUserWallet(userId, db);
  if (usdc !== "0") await chain.mintUsdc(address, parseUnits(usdc, 6));
  return { userId, address };
}

async function terms(overrides: Partial<JobTermsInput> = {}): Promise<{ input: JobTermsInput; freelancer: PrivateKeyAccount }> {
  const freelancer = privateKeyToAccount(generatePrivateKey());
  const now = Number(await chain.latestTimestamp());
  return {
    freelancer,
    input: {
      freelancer: freelancer.address,
      amountUsdc: "10",
      deliverDeadline: new Date((now + 5 * DAY) * 1000),
      reviewDays: 7,
      revisionDays: 3,
      maxRevisions: 2,
      candidateUrl: "https://example.com/freelancer",
      ...overrides,
    },
  };
}

async function freelancerSign(
  freelancer: PrivateKeyAccount,
  jobId: Hex,
  kind: number,
  data: Hex,
): Promise<{ sig: Hex; deadline: bigint }> {
  const view = await getJob(jobId);
  const deadline = (await chain.latestTimestamp()) + 600n;
  const sig = await freelancer.signTypedData({
    domain: escrowDomain(chain.ctx.chainId, chain.ctx.escrow),
    types: ACTION_TYPES,
    primaryType: "Action",
    message: actionMessage(jobId, kind, data, view.actionNonce, deadline),
  });
  return { sig, deadline };
}

const contentHash = keccak256(toBytes("https://example.com/delivery"));

describe("typed data / terms", () => {
  it("escrowDomain matches the contract domain separator", async () => {
    const onChain = await chain.publicClient.readContract({
      address: chain.ctx.escrow,
      abi: escrowAbi,
      functionName: "domainSeparator",
    });
    expect(domainSeparator({ domain: escrowDomain(chain.ctx.chainId, chain.ctx.escrow) })).toBe(onChain);
  });

  it("jobNonce TS equals contract.jobNonce", async () => {
    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const { input } = await terms();
    const t = toTerms(input, buyer);
    const jobId = newJobId(buyer);
    const onChain = await chain.publicClient.readContract({
      address: chain.ctx.escrow,
      abi: escrowAbi,
      functionName: "jobNonce",
      args: [jobId, t],
    });
    expect(jobNonce(jobId, t)).toBe(onChain);
  });

  it("newJobId puts the buyer in the high 20 bytes and is random", () => {
    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const a = newJobId(buyer);
    const b = newJobId(buyer);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.slice(0, 42)).toBe(buyer.toLowerCase());
    expect(a).not.toBe(b);
  });

  it("toTerms rejects freelancer == buyer / zero / malformed", async () => {
    const buyer = privateKeyToAccount(generatePrivateKey()).address;
    const { input } = await terms();
    expect(() => toTerms({ ...input, freelancer: buyer }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, freelancer: buyer.toLowerCase() as Address }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, freelancer: "0x0000000000000000000000000000000000000000" }, buyer)).toThrow(
      TermsError,
    );
    expect(() => toTerms({ ...input, freelancer: "0x1234" as Address }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, amountUsdc: "0" }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, amountUsdc: "-1" }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, amountUsdc: "1.1234567" }, buyer)).toThrow(TermsError);
    expect(() => toTerms({ ...input, amountUsdc: "abc" }, buyer)).toThrow(TermsError);
    try {
      toTerms({ ...input, freelancer: buyer }, buyer);
    } catch (e) {
      expect((e as Error).message).toMatch(/người thuê/);
    }
    const ok = toTerms({ ...input, amountUsdc: "1.234567" }, buyer);
    expect(ok.amount).toBe(1_234_567n);
    expect(ok.reviewWindow).toBe(7 * DAY);
    expect(ok.revisionWindow).toBe(3 * DAY);
    expect(ok.maxRevisions).toBe(2);
  });
});

describe("relay", () => {
  it("createJob locks funds and buyer pays no gas", async () => {
    const buyer = await newBuyer("100");
    const { input, freelancer } = await terms();

    const { jobId, txHash } = await createJob(buyer.userId, input, { db });

    expect(txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(jobId.slice(0, 42)).toBe(buyer.address.toLowerCase());
    expect(await chain.publicClient.getBalance({ address: buyer.address })).toBe(0n);
    expect(await chain.usdcBalance(buyer.address)).toBe(parseUnits("90", 6));
    expect(await chain.usdcBalance(chain.ctx.escrow)).toBeGreaterThanOrEqual(parseUnits("10", 6));

    const view = await getJob(jobId);
    expect(view.stateName).toBe("Funded");
    expect(view.buyer).toBe(buyer.address);
    expect(view.freelancer).toBe(freelancer.address);
    expect(view.amountUsdc).toBe("10");

    const [row] = await db.select().from(job).where(eq(job.id, jobId));
    expect(row).toMatchObject({
      userId: buyer.userId,
      freelancerAddress: freelancer.address,
      candidateUrl: "https://example.com/freelancer",
      createTx: txHash,
    });
  });

  it("createJob with insufficient USDC throws InsufficientUsdcError before any tx", async () => {
    const buyer = await newBuyer("5");
    const { input } = await terms({ amountUsdc: "10" });
    const relayer = privateKeyToAccount(chain.ctx.relayerKey).address;
    const nonceBefore = await chain.publicClient.getTransactionCount({ address: relayer });

    const err = await createJob(buyer.userId, input, { db }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientUsdcError);
    expect(err.have).toBe(parseUnits("5", 6));
    expect(err.need).toBe(parseUnits("10", 6));

    expect(await chain.publicClient.getTransactionCount({ address: relayer })).toBe(nonceBefore);
    expect(await db.select().from(job)).toHaveLength(0);
  });

  it("relayer below RELAYER_MIN_AVAX throws RelayerUnderfundedError", async () => {
    const buyer = await newBuyer("100");
    const { input } = await terms();
    const poorKey = generatePrivateKey();
    const poor = privateKeyToAccount(poorKey);
    await chain.testClient.setBalance({ address: poor.address, value: parseEther("0.01") });
    const relayerClient = createWalletClient({ chain: chain.chain, transport: http(chain.ctx.rpcUrl), account: poor });

    const err = await createJob(buyer.userId, input, { db, relayerClient }).catch((e) => e);
    expect(err).toBeInstanceOf(RelayerUnderfundedError);
    expect(await chain.publicClient.getTransactionCount({ address: poor.address })).toBe(0);
  });

  it("full flow submit→approve: availableActions correct at each step", async () => {
    const buyer = await newBuyer("100");
    const { input, freelancer } = await terms();
    const { jobId } = await createJob(buyer.userId, input, { db });

    let view = await getJob(jobId);
    expect(view.availableActions).toEqual({ buyer: [], freelancer: ["submit", "decline"], anyone: [] });

    const s = await freelancerSign(freelancer, jobId, ActionKind.Submit, contentHash);
    const submitTx = await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig);
    expect(submitTx).toMatch(/^0x[0-9a-f]{64}$/);

    view = await getJob(jobId);
    expect(view.stateName).toBe("Submitted");
    expect(view.contentHash).toBe(contentHash);
    expect(view.availableActions).toEqual({ buyer: ["approve", "requestRevision"], freelancer: [], anyone: [] });

    await buyerAction(buyer.userId, jobId, "approve", { db });
    view = await getJob(jobId);
    expect(view.stateName).toBe("Released");
    expect(view.availableActions).toEqual({ buyer: [], freelancer: [], anyone: [] });
    expect(await chain.usdcBalance(freelancer.address)).toBe(parseUnits("10", 6));
    expect(await chain.publicClient.getBalance({ address: buyer.address })).toBe(0n);
    expect(await chain.publicClient.getBalance({ address: freelancer.address })).toBe(0n);
  });

  it("requestRevision→timeout→finalize splits 50/50", async () => {
    const buyer = await newBuyer("100");
    const { input, freelancer } = await terms({ amountUsdc: "10" });
    const { jobId } = await createJob(buyer.userId, input, { db });

    const s = await freelancerSign(freelancer, jobId, ActionKind.Submit, contentHash);
    await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig);
    await buyerAction(buyer.userId, jobId, "requestRevision", { db });

    let view = await getJob(jobId);
    expect(view.stateName).toBe("RevisionRequested");
    expect(view.revisionCount).toBe(1);
    expect(view.availableActions).toEqual({ buyer: [], freelancer: ["submit"], anyone: [] });

    const early = await finalize(jobId).catch((e) => e);
    expect(early).toBeInstanceOf(ChainActionError);
    expect(early.code).toBe("TooEarly");

    await chain.increaseTime(3 * DAY + 1);
    view = await getJob(jobId);
    expect(view.availableActions).toEqual({ buyer: [], freelancer: [], anyone: ["settleSplit"] });

    await finalize(jobId);
    view = await getJob(jobId);
    expect(view.stateName).toBe("Split");
    expect(await chain.usdcBalance(buyer.address)).toBe(parseUnits("95", 6));
    expect(await chain.usdcBalance(freelancer.address)).toBe(parseUnits("5", 6));
  });

  it("submitted job past review window: claim via finalize", async () => {
    const buyer = await newBuyer("100");
    const { input, freelancer } = await terms();
    const { jobId } = await createJob(buyer.userId, input, { db });
    const s = await freelancerSign(freelancer, jobId, ActionKind.Submit, contentHash);
    await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig);

    await chain.increaseTime(7 * DAY + 1);
    const view = await getJob(jobId);
    expect(view.availableActions).toEqual({ buyer: ["approve"], freelancer: [], anyone: ["claim"] });

    const late = await buyerAction(buyer.userId, jobId, "requestRevision", { db }).catch((e) => e);
    expect(late).toBeInstanceOf(ChainActionError);
    expect(late.code).toBe("Expired");
    expect(late.message).toMatch(/thời gian duyệt/);

    await finalize(jobId);
    expect((await getJob(jobId)).stateName).toBe("Released");
    expect(await chain.usdcBalance(freelancer.address)).toBe(parseUnits("10", 6));
  });

  it("no submission past deliver deadline: buyer can refund; freelancer decline returns funds", async () => {
    const buyer = await newBuyer("100");
    const a = await terms();
    const { jobId } = await createJob(buyer.userId, a.input, { db });
    await chain.increaseTime(5 * DAY + 1);
    expect((await getJob(jobId)).availableActions).toEqual({ buyer: ["refund"], freelancer: ["decline"], anyone: [] });
    await buyerAction(buyer.userId, jobId, "refund", { db });
    expect((await getJob(jobId)).stateName).toBe("Refunded");

    const b = await terms();
    const { jobId: jobId2 } = await createJob(buyer.userId, b.input, { db });
    const d = await freelancerSign(b.freelancer, jobId2, ActionKind.Decline, zeroHash);
    await relayFreelancerAction(jobId2, "decline", zeroHash, d.deadline, d.sig);
    expect((await getJob(jobId2)).stateName).toBe("Refunded");
    expect(await chain.usdcBalance(buyer.address)).toBe(parseUnits("100", 6));
  });

  it("submit relayed twice with same sig: second throws ChainActionError, state unchanged", async () => {
    const buyer = await newBuyer("100");
    const { input, freelancer } = await terms();
    const { jobId } = await createJob(buyer.userId, input, { db });
    const s = await freelancerSign(freelancer, jobId, ActionKind.Submit, contentHash);
    await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig);
    const before = await getJob(jobId);

    const err = await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig).catch((e) => e);
    expect(err).toBeInstanceOf(ChainActionError);
    expect(err.message).toMatch(/[ạảãàáâậầấẩẫăắằẳẵặẹẻẽèéêệềếểễ]/); // Vietnamese message

    const after = await getJob(jobId);
    // everything except the read timestamp (and actions derived from it) must be identical
    expect({ ...after, now: 0 }).toEqual({ ...before, now: 0 });
    expect(after.actionNonce).toBe(before.actionNonce);
  });

  it("submit signed by a non-freelancer throws ChainActionError BadSigner", async () => {
    const buyer = await newBuyer("100");
    const { input } = await terms();
    const { jobId } = await createJob(buyer.userId, input, { db });
    const stranger = privateKeyToAccount(generatePrivateKey());
    const s = await freelancerSign(stranger, jobId, ActionKind.Submit, contentHash);
    const err = await relayFreelancerAction(jobId, "submit", contentHash, s.deadline, s.sig).catch((e) => e);
    expect(err).toBeInstanceOf(ChainActionError);
    expect(err.code).toBe("BadSigner");
    expect((await getJob(jobId)).stateName).toBe("Funded");
  });
});
