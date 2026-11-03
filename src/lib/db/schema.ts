import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const now = () => new Date();

export const wallet = sqliteTable("wallet", {
  userId: text("user_id").primaryKey(),
  address: text("address").notNull(),
  encryptedKey: text("encrypted_key").notNull(),
});

export const search = sqliteTable("search", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  brief: text("brief", { mode: "json" }).notNull(),
  candidates: text("candidates", { mode: "json" }).notNull(),
  spentUsdc: real("spent_usdc").notNull().default(0),
  warnings: text("warnings", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const x402Payment = sqliteTable("x402_payment", {
  id: text("id").primaryKey(),
  searchId: text("search_id").notNull(),
  url: text("url").notNull(),
  amountUsdc: real("amount_usdc").notNull(),
  txHash: text("tx_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

/** id is the 32-byte jobId as a 0x hex string. */
export const job = sqliteTable("job", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  freelancerAddress: text("freelancer_address").notNull(),
  candidateUrl: text("candidate_url"),
  contentUrl: text("content_url"),
  createTx: text("create_tx"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});
