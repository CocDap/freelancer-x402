import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "@/lib/db/client";
import { wallet } from "@/lib/db/schema";
import { decryptKey } from "@/lib/wallet/crypto";
import { getEnv } from "@/lib/env";
import {
  createUserWallet,
  getOrCreateUserWallet,
  getUserAccount,
  getUserAddress,
} from "@/lib/wallet/user-wallet";

let db: Db;

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});

describe("user wallet", () => {
  it("stores encrypted key, never plaintext", async () => {
    const address = await createUserWallet("u1", db);
    const rows = await db.select().from(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(address);

    const pk = decryptKey(rows[0].encryptedKey, getEnv().WALLET_ENCRYPTION_KEY);
    const raw = JSON.stringify(rows[0]).toLowerCase();
    expect(raw).not.toContain(pk.toLowerCase());
    expect(raw).not.toContain(pk.slice(2).toLowerCase());
  });

  it("getUserAccount returns account whose address matches stored", async () => {
    const address = await createUserWallet("u1", db);
    const account = await getUserAccount("u1", db);
    expect(account.address).toBe(address);
    expect(await getUserAddress("u1", db)).toBe(address);
    const [row] = await db.select().from(wallet).where(eq(wallet.userId, "u1"));
    expect(row.address).toBe(account.address);
  });

  it("fails if a wallet already exists for the user", async () => {
    await createUserWallet("u1", db);
    await expect(createUserWallet("u1", db)).rejects.toThrow();
  });

  it("getUserAddress creates a missing wallet (recovers from a failed signup hook)", async () => {
    expect(await db.select().from(wallet)).toHaveLength(0);
    const address = await getUserAddress("nobody", db);
    const rows = await db.select().from(wallet);
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(address);
    expect((await getUserAccount("nobody", db)).address).toBe(address);
  });

  it("two concurrent calls yield a single wallet with the same address", async () => {
    const [a, b] = await Promise.all([getOrCreateUserWallet("race", db), getOrCreateUserWallet("race", db)]);
    expect(a).toBe(b);
    const rows = await db.select().from(wallet).where(eq(wallet.userId, "race"));
    expect(rows).toHaveLength(1);
    expect(rows[0].address).toBe(a);
  });

  it("an existing wallet is unchanged", async () => {
    const address = await createUserWallet("keep", db);
    const [before] = await db.select().from(wallet).where(eq(wallet.userId, "keep"));
    expect(await getOrCreateUserWallet("keep", db)).toBe(address);
    const [after] = await db.select().from(wallet).where(eq(wallet.userId, "keep"));
    expect(after).toEqual(before);
  });
});
