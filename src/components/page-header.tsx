export function PageShell({ children, size = "md" }: { children: React.ReactNode; size?: "sm" | "md" }) {
  return (
    <main
      className={
        size === "sm"
          ? "mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-10"
          : "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6"
      }
    >
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
