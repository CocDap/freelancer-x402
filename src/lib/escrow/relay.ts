import "server-only";
// Server-side relay: the relayer wallet sends every escrow transaction and pays all gas.
// Buyers (custodial wallets) and freelancers (their own wallets) only sign.
import {
  BaseError,
  ContractFunctionRevertedError,
  formatEther,
  formatUnits,
  isHex,
  parseEther,
  parseUnits,
  size,
  zeroHash,
  type Address,
  type Hex,
} from "viem";
import { and, eq, isNull } from "drizzle-orm";
import { escrowAbi } from "@/lib/chain/escrow-abi";
import { RECEIVE_WITH_AUTHORIZATION_TYPES, usdcAbi } from "@/lib/chain/usdc-abi";
import { resolveChainClients, type ChainClients, type ChainDeps } from "@/lib/chain/clients";
import { getDb, type Db } from "@/lib/db/client";
import { job, wallet } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { getOrCreateUserWallet, getUserAccount } from "@/lib/wallet/user-wallet";
import { ACTION_TYPES, ActionKind, actionMessage, escrowDomain } from "./typed-data";
import { TermsError, USDC_DECIMALS, jobNonce, newJobId, toTerms, type JobTermsInput } from "./terms";
import { getJob, type BuyerActionKind, type FreelancerActionKind } from "./read";

export type RelayDeps = ChainDeps & { db?: Db };

/** Lifetime of signatures the server creates (EIP-3009 auth, buyer Action sigs), from the latest block time. */
const SIGNATURE_TTL_SECONDS = 3600n;

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

export class RelayerUnderfundedError extends Error {
  constructor(
    readonly balance: bigint,
    readonly min: bigint,
  ) {
    super(
      `Ví relayer không đủ AVAX để trả phí gas (còn ${formatEther(balance)} AVAX, cần tối thiểu ${formatEther(min)} AVAX). Vui lòng nạp thêm AVAX cho relayer.`,
    );
    this.name = "RelayerUnderfundedError";
  }
}

export class InsufficientUsdcError extends Error {
  constructor(
    readonly have: bigint,
    readonly need: bigint,
  ) {
    super(
      `Số dư USDC không đủ: có ${formatUnits(have, USDC_DECIMALS)} USDC, cần ${formatUnits(need, USDC_DECIMALS)} USDC.`,
    );
    this.name = "InsufficientUsdcError";
  }
}

/**
 * createJob failed AFTER the job row was written and the tx was (about to be) broadcast. The escrow may or may
 * not be funded: callers must NOT ask the user to retry (a retry would fund a second escrow) and should send
 * them to the job page, which shows the on-chain state / reconcile hint.
 */
export class JobPendingError extends Error {
  constructor(
    readonly jobId: Hex,
    options?: { cause?: unknown },
  ) {
    super("Job đã được gửi lên chuỗi nhưng chưa xác nhận được kết quả. Vui lòng kiểm tra trang job, đừng tạo lại.", options);
    this.name = "JobPendingError";
  }
}

/** Malformed relay input (bad kind / signature / hash); nothing was sent. Routes should map it to 400. */
export class RelayInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayInputError";
  }
}

/** Smallest accepted relayed signature: 65-byte ECDSA (ERC-1271 signatures may be longer). */
export const MIN_SIGNATURE_BYTES = 65;

export type RelayAction =
  | "createJob"
  | "submit"
  | "decline"
  | "approve"
  | "requestRevision"
  | "refund"
  | "claim"
  | "settleSplit"
  | "finalize";

const USDC_AUTH_ERRORS = new Set([
  "InvalidSignature",
  "AuthorizationExpired",
  "AuthorizationNotYetValid",
  "AuthorizationUsedOrCanceled",
  "CallerMustBePayee",
]);

/** Vietnamese message for a contract custom error, with context of the attempted action. */
export function chainErrorMessage(code: string, action: RelayAction): string {
  switch (code) {
    case "BadState":
      return "Job không ở trạng thái cho phép thao tác này (có thể đã được xử lý trước đó).";
    case "BadSigner":
      return action === "submit" || action === "decline"
        ? "Chữ ký không phải của ví freelancer của job này."
        : "Chữ ký không phải của người có quyền thực hiện thao tác này.";
    case "Expired":
      // Expired covers both "signature deadline passed" and "action window closed".
      if (action === "submit") return "Đã quá hạn nộp bài hoặc chữ ký đã hết hạn.";
      if (action === "requestRevision") return "Đã hết thời gian duyệt, không thể yêu cầu sửa nữa.";
      return "Chữ ký đã hết hạn, vui lòng thử lại.";
    case "TooEarly":
      if (action === "refund") return "Chưa quá hạn giao bài, chưa thể hoàn tiền.";
      if (action === "claim") return "Chưa hết thời gian duyệt, chưa thể hoàn tất.";
      if (action === "settleSplit") return "Chưa hết thời gian sửa bài, chưa thể chia tiền.";
      return "Chưa đến thời điểm được phép thực hiện thao tác này.";
    case "BadTerms":
      return "Điều khoản job không hợp lệ (kiểm tra hạn giao bài, thời gian duyệt/sửa và số lần sửa).";
    case "JobExists":
      return "Job này đã tồn tại.";
    case "NoRevisionsLeft":
      return "Đã hết số lần yêu cầu sửa.";
    case "BadJobId":
      return "Mã job không thuộc về ví người thuê.";
    case "NotBuyer":
      return "Bạn không phải người thuê của job này.";
    default:
      if (USDC_AUTH_ERRORS.has(code)) return "Chữ ký chuyển USDC không hợp lệ hoặc đã hết hạn.";
      return "Giao dịch bị từ chối bởi hợp đồng.";
  }
}

export class ChainActionError extends Error {
  constructor(
    /** Contract custom error name (e.g. "BadState"), revert reason, or "Reverted". */
    readonly code: string,
    readonly action: RelayAction,
    options?: { cause?: unknown },
  ) {
    super(chainErrorMessage(code, action), options);
    this.name = "ChainActionError";
  }
}

/** Wraps contract reverts into ChainActionError; anything else (network etc.) is returned unchanged. */
function toChainActionError(err: unknown, action: RelayAction): unknown {
  if (!(err instanceof BaseError)) return err;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return err;
  const code = reverted.data?.errorName ?? reverted.reason ?? "Reverted";
  return new ChainActionError(code, action, { cause: err });
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

async function assertRelayerFunded(c: ChainClients): Promise<void> {
  const min = parseEther(String(c.relayerMinAvax));
  const balance = await c.publicClient.getBalance({ address: c.relayerClient.account.address });
  if (balance < min) throw new RelayerUnderfundedError(balance, min);
}

// Serialize sends per relayer within this process so concurrent requests don't race on the account nonce.
const relayerLocks = new Map<string, Promise<unknown>>();
function withRelayerLock<T>(relayer: Address, fn: () => Promise<T>): Promise<T> {
  const prev = relayerLocks.get(relayer) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  relayerLocks.set(
    relayer,
    next.catch(() => undefined),
  );
  return next;
}

type EscrowWrite =
  | { functionName: "createJob"; args: readonly [Hex, Address, ReturnType<typeof toTerms>, bigint, bigint, Hex] }
  | { functionName: "submit"; args: readonly [Hex, Hex, bigint, Hex] }
  | { functionName: "decline" | "approve" | "requestRevision" | "refund"; args: readonly [Hex, bigint, Hex] }
  | { functionName: "claim" | "settleSplit"; args: readonly [Hex] };

/**
 * Funds check, simulate (decodes reverts without spending gas), send, wait for receipt.
 * `beforeBroadcast` runs after a successful simulation and right before the tx is broadcast; if it throws,
 * nothing is sent. Errors before broadcast: RelayerUnderfundedError, ChainActionError (simulate), or the hook's
 * error. Errors after broadcast (writeContract / receipt) may mean the tx still lands on-chain.
 */
async function sendEscrowTx(
  c: ChainClients,
  action: RelayAction,
  call: EscrowWrite,
  beforeBroadcast?: () => Promise<void>,
): Promise<Hex> {
  await assertRelayerFunded(c);
  const account = c.relayerClient.account;
  return withRelayerLock(account.address, async () => {
    let request;
    try {
      ({ request } = await c.publicClient.simulateContract({
        address: c.escrow,
        abi: escrowAbi,
        account,
        ...call,
      } as Parameters<typeof c.publicClient.simulateContract>[0]));
    } catch (err) {
      throw toChainActionError(err, action);
    }
    await beforeBroadcast?.();
    const hash = await c.relayerClient.writeContract(request as Parameters<typeof c.relayerClient.writeContract>[0]);
    const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new ChainActionError("Reverted", action);
    return hash;
  });
}

const usdcDomainCache = new Map<string, Promise<{ name: string; version: string }>>();

/** EIP-3009 domain name/version read from the token itself (cached per chain + address). */
function usdcDomainInfo(c: ChainClients): Promise<{ name: string; version: string }> {
  const key = `${c.chain.id}:${c.usdc.toLowerCase()}`;
  let hit = usdcDomainCache.get(key);
  if (!hit) {
    hit = Promise.all([
      c.publicClient.readContract({ address: c.usdc, abi: usdcAbi, functionName: "name" }),
      c.publicClient.readContract({ address: c.usdc, abi: usdcAbi, functionName: "version" }),
    ]).then(([name, version]) => ({ name, version }));
    hit.catch(() => usdcDomainCache.delete(key));
    usdcDomainCache.set(key, hit);
  }
  return hit;
}

async function latestTimestamp(c: ChainClients): Promise<bigint> {
  return (await c.publicClient.getBlock({ blockTag: "latest" })).timestamp;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Funds a new job from the user's custodial wallet: validates terms, checks USDC balance, signs EIP-3009
 * `receiveWithAuthorization` with nonce = jobNonce(jobId, terms), relays `createJob`, waits for the receipt,
 * then stores the `job` row.
 */
export async function createJob(
  userId: string,
  input: JobTermsInput,
  deps: RelayDeps = {},
): Promise<{ jobId: Hex; txHash: Hex }> {
  const c = await resolveChainClients(deps);
  const database = deps.db ?? getDb();
  const buyer = await getUserAccount(userId, database);
  const terms = toTerms(input, buyer.address, { relayer: c.relayerClient.account.address, escrow: c.escrow });

  const now = await latestTimestamp(c);
  if (terms.deliverDeadline <= now) throw new TermsError("Hạn giao bài phải ở tương lai.");

  const have = await c.publicClient.readContract({
    address: c.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [buyer.address],
  });
  if (have < terms.amount) throw new InsufficientUsdcError(have, terms.amount);

  const jobId = newJobId(buyer.address);
  const { name, version } = await usdcDomainInfo(c);
  const validAfter = 0n;
  const validBefore = now + SIGNATURE_TTL_SECONDS;
  const usdcSig = await buyer.signTypedData({
    domain: { name, version, chainId: c.chain.id, verifyingContract: c.usdc },
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: "ReceiveWithAuthorization",
    message: {
      from: buyer.address,
      to: c.escrow,
      value: terms.amount,
      validAfter,
      validBefore,
      nonce: jobNonce(jobId, terms),
    },
  });

  // The job row is written after simulation succeeds and BEFORE broadcast (createTx null), so a crash or a
  // receipt timeout after broadcast never leaves funded escrow the app doesn't know about; such rows are
  // reconciled with getJob(). Pre-send failures (USDC/relayer balance, simulate revert, insert error) send
  // nothing and leave no row. Once the row exists, ANY failure (writeContract, transport, receipt timeout,
  // revert) surfaces as JobPendingError: the tx may still land, so the caller must never offer a retry.
  let inserted = false;
  let txHash: Hex;
  try {
    txHash = await sendEscrowTx(
      c,
      "createJob",
      {
        functionName: "createJob",
        args: [jobId, buyer.address, terms, validAfter, validBefore, usdcSig],
      },
      async () => {
        await database.insert(job).values({
          id: jobId,
          userId,
          freelancerAddress: terms.freelancer,
          candidateUrl: input.candidateUrl ?? null,
          createTx: null,
        });
        inserted = true;
      },
    );
  } catch (err) {
    if (inserted) {
      console.error("[relay] createJob failed after broadcast:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
      throw new JobPendingError(jobId, { cause: err });
    }
    throw err;
  }

  try {
    await database.update(job).set({ createTx: txHash }).where(eq(job.id, jobId));
  } catch (err) {
    // The job is funded; a missing createTx is cosmetic (the job page reads chain state).
    console.error("[relay] could not store createTx:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
  }

  return { jobId, txHash };
}

const BUYER_KIND = {
  approve: ActionKind.Approve,
  requestRevision: ActionKind.RequestRevision,
  refund: ActionKind.Refund,
} as const satisfies Record<BuyerActionKind, number>;

/** Signs an EIP-712 Action with the user's custodial wallet and relays approve / requestRevision / refund. */
export async function buyerAction(
  userId: string,
  jobId: Hex,
  kind: BuyerActionKind,
  deps: RelayDeps = {},
): Promise<Hex> {
  const c = await resolveChainClients(deps);
  const buyer = await getUserAccount(userId, deps.db ?? getDb());
  const view = await getJob(jobId, c);
  if (view.stateName === "None") throw new ChainActionError("BadState", kind);
  if (view.buyer.toLowerCase() !== buyer.address.toLowerCase()) throw new ChainActionError("NotBuyer", kind);

  const deadline = view.now + SIGNATURE_TTL_SECONDS;
  const sig = await buyer.signTypedData({
    domain: escrowDomain(c.chain.id, c.escrow),
    types: ACTION_TYPES,
    primaryType: "Action",
    message: actionMessage(jobId, BUYER_KIND[kind], zeroHash, view.actionNonce, deadline),
  });
  return sendEscrowTx(c, kind, { functionName: kind, args: [jobId, deadline, sig] });
}

/**
 * Relays a freelancer-signed Action. For "submit", `contentHash` is the signed `data`; for "decline" the
 * signed `data` is bytes32 zero (pass zeroHash) and the contract call takes no data argument.
 */
export async function relayFreelancerAction(
  jobId: Hex,
  kind: FreelancerActionKind,
  contentHash: Hex,
  deadline: bigint,
  sig: Hex,
  deps: RelayDeps = {},
  /** Runs after simulate succeeds and right before broadcast (e.g. persist the submitted URL); if it throws, nothing is sent. */
  beforeBroadcast?: () => Promise<void>,
): Promise<Hex> {
  if (kind !== "submit" && kind !== "decline") {
    throw new RelayInputError(`Thao tác freelancer không hợp lệ: ${String(kind)} (chỉ chấp nhận submit hoặc decline).`);
  }
  // An empty sig would hit the contract's direct-call path (msg.sender == freelancer), where msg.sender is the
  // relayer: never forward one. >= 65 bytes admits ECDSA (65) and longer ERC-1271 smart-wallet signatures.
  if (typeof sig !== "string" || !isHex(sig, { strict: true }) || size(sig) < MIN_SIGNATURE_BYTES) {
    throw new RelayInputError("Chữ ký không hợp lệ (cần chữ ký EIP-712 của ví freelancer).");
  }
  if (kind === "submit" && (typeof contentHash !== "string" || !isHex(contentHash, { strict: true }) || size(contentHash) !== 32)) {
    throw new RelayInputError("Mã băm nội dung bài nộp không hợp lệ (cần 32 byte).");
  }
  if (typeof deadline !== "bigint") throw new RelayInputError("Hạn chữ ký không hợp lệ.");

  const c = await resolveChainClients(deps);
  if (kind === "submit") {
    return sendEscrowTx(c, "submit", { functionName: "submit", args: [jobId, contentHash, deadline, sig] }, beforeBroadcast);
  }
  return sendEscrowTx(c, "decline", { functionName: "decline", args: [jobId, deadline, sig] }, beforeBroadcast);
}

export type WelcomeGrantResult =
  | { status: "sent"; txHash: Hex }
  | { status: "skipped"; reason: "disabled" | "already-granted" | "relayer-low-usdc" };

/**
 * Sends the one-time welcome grant (WELCOME_GRANT_USDC, default 0.3) from the relayer to the user's wallet.
 * At most once per wallet: the row is claimed (`welcome_grant_tx` null -> "pending") before anything is sent,
 * so concurrent callers can't double-pay. A failure before broadcast releases the claim for a later retry;
 * after broadcast the tx hash is stored and the grant is never re-sent. A relayer without enough USDC is a
 * skip (logged), not an error. Throws RelayerUnderfundedError when the relayer lacks AVAX for gas.
 */
export async function grantWelcomeUsdc(
  userId: string,
  deps: RelayDeps & { amountUsdc?: number } = {},
): Promise<WelcomeGrantResult> {
  const amountUsdc = deps.amountUsdc ?? getEnv().WELCOME_GRANT_USDC;
  if (amountUsdc <= 0) return { status: "skipped", reason: "disabled" };

  const database = deps.db ?? getDb();
  const to = await getOrCreateUserWallet(userId, database);
  const [row] = await database.select({ tx: wallet.welcomeGrantTx }).from(wallet).where(eq(wallet.userId, userId));
  if (row?.tx) return { status: "skipped", reason: "already-granted" };

  const c = await resolveChainClients(deps);
  const value = parseUnits(String(amountUsdc), USDC_DECIMALS);
  const account = c.relayerClient.account;
  const relayerUsdc = await c.publicClient.readContract({
    address: c.usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (relayerUsdc < value) {
    console.warn(
      `[relay] welcome grant skipped: relayer has ${formatUnits(relayerUsdc, USDC_DECIMALS)} USDC, needs ${amountUsdc}`,
    );
    return { status: "skipped", reason: "relayer-low-usdc" };
  }
  await assertRelayerFunded(c);

  const claimed = await database
    .update(wallet)
    .set({ welcomeGrantTx: "pending" })
    .where(and(eq(wallet.userId, userId), isNull(wallet.welcomeGrantTx)))
    .returning({ userId: wallet.userId });
  if (claimed.length === 0) return { status: "skipped", reason: "already-granted" };

  let hash: Hex | undefined;
  try {
    return await withRelayerLock(account.address, async () => {
      const { request } = await c.publicClient.simulateContract({
        address: c.usdc,
        abi: usdcAbi,
        functionName: "transfer",
        args: [to, value],
        account,
      });
      hash = await c.relayerClient.writeContract(request);
      await database.update(wallet).set({ welcomeGrantTx: hash }).where(eq(wallet.userId, userId));
      const receipt = await c.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`welcome grant tx ${hash} reverted`);
      return { status: "sent", txHash: hash } as const;
    });
  } catch (err) {
    // Not broadcast: release the claim so a later call can retry. Broadcast: keep the hash, never re-send.
    if (!hash) await database.update(wallet).set({ welcomeGrantTx: null }).where(eq(wallet.userId, userId));
    throw err;
  }
}

/** Permissionless settlement: `claim` when Submitted, `settleSplit` when RevisionRequested. */
export async function finalize(jobId: Hex, deps: RelayDeps = {}): Promise<Hex> {
  const c = await resolveChainClients(deps);
  const view = await getJob(jobId, c);
  if (view.stateName === "Submitted") {
    return sendEscrowTx(c, "claim", { functionName: "claim", args: [jobId] });
  }
  if (view.stateName === "RevisionRequested") {
    return sendEscrowTx(c, "settleSplit", { functionName: "settleSplit", args: [jobId] });
  }
  throw new ChainActionError("BadState", "finalize");
}
