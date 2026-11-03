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

// better-auth tables (drizzle adapter, provider "sqlite", username plugin).
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  username: text("username").unique(),
  displayUsername: text("display_username"),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(now),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).$defaultFn(now),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(now),
});
