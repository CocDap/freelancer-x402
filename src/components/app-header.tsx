import Link from "next/link";
import { Suspense } from "react";
import { NavLinks, StaticNavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-4 px-4 sm:px-6">
        <Link href="/search" className="font-heading text-sm font-semibold tracking-tight">
          Thuê freelancer
        </Link>
        {/* usePathname is request data: under cacheComponents it must sit inside Suspense.
            The fallback is the same links without the active highlight. */}
        <Suspense fallback={<StaticNavLinks />}>
          <NavLinks />
        </Suspense>
        <ThemeToggle />
        <Suspense fallback={null}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
