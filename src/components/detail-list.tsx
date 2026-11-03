export function DetailList({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y text-sm">{children}</dl>;
}

export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
      <dt className="w-44 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}

export function ExtLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground/80">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}
