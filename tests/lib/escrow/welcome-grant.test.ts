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
import { getUserAddress } from "@/lib/wallet/user-wallet";

const chain = setupAnvil();
const relayer = privateKeyToAccount(chain.ctx.relayerKey).address;
let db: Db;

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  await chain.mintUsdc(relayer, parseUnits("10", 6));
});

let userSeq = 0;
const newUserId = () => `grant-${++userSeq}-${Date.now()}`;

async function grantTx(userId: string) {
  const [row] = await db.select({ tx: wallet.welcomeGrantTx }).from(wallet).where(eq(wallet.userId, userId));
  return row?.tx ?? null;
}

describe("grantWelcomeUsdc", () => {
  it("sends the grant once and stores the tx hash", async () => {
    const userId = newUserId();
    const first = await grantWelcomeUsdc(userId, { db, amountUsdc: 0.3 });
    expect(first.status).toBe("sent");
    const address = await getUserAddress(userId, db);
    expect(await chain.usdcBalance(address)).toBe(parseUnits("0.3", 6));
    expect(await grantTx(userId)).toBe(first.status === "sent" ? first.txHash : "");

    expect(await grantWelcomeUsdc(userId, { db, amountUsdc: 0.3 })).toEqual({ status: "skipped", reason: "already-granted" });
    expect(await chain.usdcBalance(address)).toBe(parseUnits("0.3", 6));
  });

  it("concurrent calls pay only once", async () => {
    const userId = newUserId();
    await getUserAddress(userId, db);
    const results = await Promise.all([
      grantWelcomeUsdc(userId, { db, amountUsdc: 0.3 }),
      grantWelcomeUsdc(userId, { db, amountUsdc: 0.3 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["sent", "skipped"]);
    expect(await chain.usdcBalance(await getUserAddress(userId, db))).toBe(parseUnits("0.3", 6));
  });

  it("amount 0 disables the grant", async () => {
    const userId = newUserId();
    expect(await grantWelcomeUsdc(userId, { db, amountUsdc: 0 })).toEqual({ status: "skipped", reason: "disabled" });
    expect(await grantTx(userId)).toBeNull();
  });

  it("skips without claiming when the relayer lacks USDC, so a later call can still grant", async () => {
    const userId = newUserId();
    expect(await grantWelcomeUsdc(userId, { db, amountUsdc: 1_000_000_000 })).toEqual({
      status: "skipped",
      reason: "relayer-low-usdc",
    });
    expect(await grantTx(userId)).toBeNull();
    expect((await grantWelcomeUsdc(userId, { db, amountUsdc: 0.3 })).status).toBe("sent");
  });

  it("relayer without AVAX throws and leaves the wallet unclaimed", async () => {
    const userId = newUserId();
    await expect(grantWelcomeUsdc(userId, { db, amountUsdc: 0.3, relayerMinAvax: 1_000_000_000 })).rejects.toBeInstanceOf(
      RelayerUnderfundedError,
    );
    expect(await grantTx(userId)).toBeNull();
  });
});

describe("signup welcome grant", () => {
  afterEach(() => {
    process.env.WELCOME_GRANT_USDC = "0";
    resetEnvCache();
  });

  it("new signup wallet receives WELCOME_GRANT_USDC", async () => {
    process.env.WELCOME_GRANT_USDC = "0.3";
    resetEnvCache();
    const res = await createAuth(db).api.signUpEmail({
      body: { email: "alice@users.invalid", name: "alice", username: "alice", password: "password123" },
    });
    const address = await getUserAddress(res.user.id, db);
    expect(await chain.usdcBalance(address)).toBe(parseUnits("0.3", 6));
    expect(await grantTx(res.user.id)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
