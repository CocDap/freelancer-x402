import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { setupAnvil } from "../../setup/chain";
import { createDb, type Db } from "@/lib/db/client";
import { wallet } from "@/lib/db/schema";
import { createAuth } from "@/lib/auth";
import { resetEnvCache } from "@/lib/env";
import { RelayerUnderfundedError, grantWelcomeUsdc } from "@/lib/escrow/relay";
import { clientIp } from "@/lib/request-ip";
import { getUserAddress } from "@/lib/wallet/user-wallet";

const chain = setupAnvil();
const relayer = privateKeyToAccount(chain.ctx.relayerKey).address;
let db: Db;

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await chain.mintUsdc(relayer, parseUnits("10", 6));
});

let seq = 0;
const newUserId = () => `grant-${++seq}-${Date.now()}`;
const newIp = () => `203.0.113.${++seq % 250}`;

async function grantRow(userId: string) {
  const [row] = await db
    .select({ tx: wallet.welcomeGrantTx, ipHash: wallet.welcomeGrantIpHash })
    .from(wallet)
    .where(eq(wallet.userId, userId));
  return row ?? { tx: null, ipHash: null };
}

async function balanceOf(userId: string) {
  return chain.usdcBalance(await getUserAddress(userId, db));
}

describe("grantWelcomeUsdc", () => {
  it("sends the grant once and stores the tx hash", async () => {
    const userId = newUserId();
    const ip = newIp();
    const first = await grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 });
    if (first.status !== "sent") throw new Error(`expected sent, got ${first.reason}`);
    expect(await balanceOf(userId)).toBe(parseUnits("0.3", 6));
    expect((await grantRow(userId)).tx).toBe(first.txHash);

    expect(await grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 })).toEqual({ status: "skipped", reason: "already-granted" });
    expect(await balanceOf(userId)).toBe(parseUnits("0.3", 6));
  });

  it("concurrent calls for one user pay only once", async () => {
    const userId = newUserId();
    const ip = newIp();
    await getUserAddress(userId, db);
    const results = await Promise.all([
      grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 }),
      grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["sent", "skipped"]);
    expect(await balanceOf(userId)).toBe(parseUnits("0.3", 6));
  });

  it("a second account from the same IP gets nothing", async () => {
    const ip = newIp();
    const alice = newUserId();
    const bob = newUserId();
    expect((await grantWelcomeUsdc(alice, ip, { db, amountUsdc: 0.3 })).status).toBe("sent");
    expect(await grantWelcomeUsdc(bob, ip, { db, amountUsdc: 0.3 })).toEqual({ status: "skipped", reason: "ip-already-granted" });
    expect(await balanceOf(bob)).toBe(0n);
    // A different IP still gets its grant.
    expect((await grantWelcomeUsdc(bob, newIp(), { db, amountUsdc: 0.3 })).status).toBe("sent");
  });

  it("concurrent accounts from one IP: only one is paid", async () => {
    const ip = newIp();
    const users = [newUserId(), newUserId()];
    await Promise.all(users.map((u) => getUserAddress(u, db)));
    const results = await Promise.all(users.map((u) => grantWelcomeUsdc(u, ip, { db, amountUsdc: 0.3 })));
    expect(results.map((r) => r.status).sort()).toEqual(["sent", "skipped"]);
    const balances = await Promise.all(users.map(balanceOf));
    expect(balances.reduce((a, b) => a + b, 0n)).toBe(parseUnits("0.3", 6));
  });

  it("unknown IPs share one grant", async () => {
    expect((await grantWelcomeUsdc(newUserId(), null, { db, amountUsdc: 0.3 })).status).toBe("sent");
    expect(await grantWelcomeUsdc(newUserId(), null, { db, amountUsdc: 0.3 })).toEqual({
      status: "skipped",
      reason: "ip-already-granted",
    });
  });

  it("does not store the raw IP", async () => {
    const userId = newUserId();
    const ip = newIp();
    await grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 });
    const { ipHash } = await grantRow(userId);
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash).not.toContain(ip);
  });

  it("amount 0 disables the grant", async () => {
    const userId = newUserId();
    expect(await grantWelcomeUsdc(userId, newIp(), { db, amountUsdc: 0 })).toEqual({ status: "skipped", reason: "disabled" });
    expect((await grantRow(userId)).tx).toBeNull();
  });

  it("skips without claiming when the relayer lacks USDC, so a later call can still grant", async () => {
    const userId = newUserId();
    const ip = newIp();
    expect(await grantWelcomeUsdc(userId, ip, { db, amountUsdc: 1_000_000_000 })).toEqual({
      status: "skipped",
      reason: "relayer-low-usdc",
    });
    expect(await grantRow(userId)).toEqual({ tx: null, ipHash: null });
    expect((await grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3 })).status).toBe("sent");
  });

  it("relayer without AVAX throws and leaves the wallet and IP unclaimed", async () => {
    const userId = newUserId();
    const ip = newIp();
    await expect(
      grantWelcomeUsdc(userId, ip, { db, amountUsdc: 0.3, relayerMinAvax: 1_000_000_000 }),
    ).rejects.toBeInstanceOf(RelayerUnderfundedError);
    expect(await grantRow(userId)).toEqual({ tx: null, ipHash: null });
    expect((await grantWelcomeUsdc(newUserId(), ip, { db, amountUsdc: 0.3 })).status).toBe("sent");
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 198.51.100.7 , 10.0.0.1" }))).toBe("198.51.100.7");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.8" }))).toBe("198.51.100.8");
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });
});

describe("signup welcome grant", () => {
  afterEach(() => {
    process.env.WELCOME_GRANT_USDC = "0";
    resetEnvCache();
  });

  it("first signup from an IP gets WELCOME_GRANT_USDC, a second signup from that IP does not", async () => {
    process.env.WELCOME_GRANT_USDC = "0.3";
    resetEnvCache();
    const auth = createAuth(db);
    const headers = new Headers({ "x-forwarded-for": newIp() });
    const signUp = (name: string) =>
      auth.api.signUpEmail({
        body: { email: `${name}@users.invalid`, name, username: name, password: "password123" },
        headers,
      });

    const alice = await signUp("alice");
    expect(await balanceOf(alice.user.id)).toBe(parseUnits("0.3", 6));
    expect((await grantRow(alice.user.id)).tx).toMatch(/^0x[0-9a-f]{64}$/);

    const bob = await signUp("bob");
    expect(await balanceOf(bob.user.id)).toBe(0n);
    expect((await grantRow(bob.user.id)).tx).toBeNull();
  });
});
