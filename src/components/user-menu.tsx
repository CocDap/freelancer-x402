import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { LogoutButton } from "./logout-button";

/** Signed-in user's name + logout. Reads the session (request data), so render it inside Suspense. */
export async function UserMenu() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as { username?: string | null; name: string };
  return (
    <div className="flex items-center gap-1">
      <span className="hidden max-w-32 truncate text-sm text-muted-foreground sm:inline">{u.username ?? u.name}</span>
      <LogoutButton />
    </div>
  );
}
