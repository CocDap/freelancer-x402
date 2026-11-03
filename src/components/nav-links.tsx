"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/search", label: "Tìm kiếm" },
  { href: "/jobs", label: "Công việc" },
  { href: "/wallet", label: "Ví" },
];

function Links({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV.map((item) => {
        const active = !!pathname && (pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
              active && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function NavLinks() {
  return <Links pathname={usePathname()} />;
}

export function StaticNavLinks() {
  return <Links pathname={null} />;
}
