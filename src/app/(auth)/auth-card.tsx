"use client";

import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { PageShell } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** Shared username/password card for login and signup. `submit` returns an error message or null. */
export function AuthCard({
  title,
  description,
  passwordLabel,
  passwordAutoComplete,
  minLength,
  submitLabel,
  pendingLabel,
  footer,
  submit,
}: {
  title: string;
  description: string;
  passwordLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
  minLength?: number;
  submitLabel: string;
  pendingLabel: string;
  footer: { text: string; href: string; link: string };
  submit: (form: FormData) => Promise<string | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const message = await submit(form);
    setPending(false);
    if (message) setError(message);
  }

  return (
    <PageShell size="sm">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <FormField label="Tên đăng nhập" htmlFor="username">
              <Input id="username" name="username" required autoComplete="username" />
            </FormField>
            <FormField label={passwordLabel} htmlFor="password">
              <Input id="password" name="password" type="password" required minLength={minLength} autoComplete={passwordAutoComplete} />
            </FormField>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? pendingLabel : submitLabel}
            </Button>
          </CardContent>
        </form>
        <CardFooter className="text-sm text-muted-foreground">
          {footer.text}&nbsp;
          <Link href={footer.href} className="text-foreground underline underline-offset-4">
            {footer.link}
          </Link>
        </CardFooter>
      </Card>
    </PageShell>
  );
}
