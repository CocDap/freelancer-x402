import "server-only";
import { createClient } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Db = LibSQLDatabase<typeof schema>;

export function createDb(url: string, authToken?: string): Db {
  return drizzle(createClient({ url, authToken }), { schema });
}

let defaultDb: Db | undefined;

/** Lazily-created default database from DATABASE_URL / DATABASE_AUTH_TOKEN. */
export function getDb(): Db {
  if (!defaultDb) {
    const env = getEnv();
    defaultDb = createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
  }
  return defaultDb;
}

/** Default db; resolves the real connection on first property access. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
