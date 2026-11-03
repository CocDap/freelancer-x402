import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { username } from "better-auth/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { grantWelcomeUsdc } from "@/lib/escrow/relay";
import { getOrCreateUserWallet } from "@/lib/wallet/user-wallet";

/** Builds a better-auth instance bound to `database` (tests pass an in-memory db). */
export function createAuth(database: Db = getDb()) {
  const env = getEnv();
  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.APP_URL,
    database: drizzleAdapter(database, { provider: "sqlite", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    plugins: [username(), nextCookies()],
    databaseHooks: {
      user: {
        create: {
          // Single-user tool: only the very first signup is allowed.
          before: async () => {
            const existing = await database.select({ id: schema.user.id }).from(schema.user).limit(1);
            if (existing.length > 0) {
              throw new APIError("FORBIDDEN", { message: "Signup is closed" });
            }
          },
          after: async (created) => {
            // Fast path; getUserAccount/getUserAddress recover if this fails (the hook runs after commit).
            await getOrCreateUserWallet(created.id, database);
            // Never fails signup: on error the wallet page retries the grant later.
            await grantWelcomeUsdc(created.id, { db: database }).catch((err: unknown) => {
              console.error("[auth] welcome grant failed:", err instanceof Error ? `${err.name}: ${err.message}` : "unknown");
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let defaultAuth: Auth | undefined;

export function getAuth(): Auth {
  return (defaultAuth ??= createAuth());
}

/** Default auth; constructed on first property access (env is read lazily). */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    const real = getAuth();
    return Reflect.get(real, prop, real);
  },
});

/** Real session check for server components / route handlers. Redirects to /login. */
export async function requireUser(): Promise<{ id: string; username: string }> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const u = session.user as { id: string; username?: string | null; name: string };
  return { id: u.id, username: u.username ?? u.name };
}
