import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, type Db } from "@/lib/db/client";
import { createAuth } from "@/lib/auth";
import { getUserAddress } from "@/lib/wallet/user-wallet";

let db: Db;
let auth: ReturnType<typeof createAuth>;

const signUp = (username: string, password = "password123") =>
  auth.api.signUpEmail({
    body: { email: `${username}@users.invalid`, name: username, username, password },
  });

beforeEach(async () => {
  db = createDb("file::memory:");
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  auth = createAuth(db);
});

describe("auth", () => {
  it("first signup succeeds and creates wallet", async () => {
    const res = await signUp("alice");
    expect(res.user.id).toBeTruthy();
    expect(await getUserAddress(res.user.id, db)).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("more users can sign up, each with their own wallet", async () => {
    const alice = await signUp("alice");
    const bob = await signUp("bob");
    expect(bob.user.id).not.toBe(alice.user.id);
    expect(await getUserAddress(bob.user.id, db)).not.toBe(await getUserAddress(alice.user.id, db));
  });

  it("duplicate username rejected", async () => {
    await signUp("alice");
    await expect(signUp("alice", "otherpass99")).rejects.toMatchObject({ statusCode: expect.any(Number) });
  });

  it("login with username+password returns session", async () => {
    await signUp("alice");
    const res = await auth.api.signInUsername({ body: { username: "alice", password: "password123" } });
    expect(res?.token).toBeTruthy();
    expect(res?.user.id).toBeTruthy();
  });

  it("wrong password rejected", async () => {
    await signUp("alice");
    await expect(
      auth.api.signInUsername({ body: { username: "alice", password: "wrongpass99" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});
