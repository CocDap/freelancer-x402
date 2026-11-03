import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { getDb, type Db } from "@/lib/db/client";
import { wallet } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { decryptKey, encryptKey } from "./crypto";

/** Creates the user's custodial wallet. Throws if one already exists. */
export async function createUserWallet(userId: string, database: Db = getDb()): Promise<Address> {
  const existing = await database.select({ userId: wallet.userId }).from(wallet).where(eq(wallet.userId, userId));
  if (existing.length > 0) throw new Error(`Wallet already exists for user ${userId}`);

  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  // PK primary key also enforces one wallet per user against races.
  await database.insert(wallet).values({
    userId,
    address,
    encryptedKey: encryptKey(pk, getEnv().WALLET_ENCRYPTION_KEY),
  });
  return address;
}

async function getRow(userId: string, database: Db) {
  const [row] = await database.select().from(wallet).where(eq(wallet.userId, userId));
  if (!row) throw new Error(`No wallet for user ${userId}`);
  return row;
}

/** Decrypts in memory only; the private key is never returned or logged. */
export async function getUserAccount(userId: string, database: Db = getDb()): Promise<PrivateKeyAccount> {
  const row = await getRow(userId, database);
  return privateKeyToAccount(decryptKey(row.encryptedKey, getEnv().WALLET_ENCRYPTION_KEY));
}

export async function getUserAddress(userId: string, database: Db = getDb()): Promise<Address> {
  return (await getRow(userId, database)).address as Address;
}
