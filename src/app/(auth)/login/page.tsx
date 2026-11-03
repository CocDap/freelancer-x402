"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.username({
      username: String(form.get("username")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError("Tên đăng nhập hoặc mật khẩu không đúng.");
    router.push("/search");
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Đăng nhập</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Tên đăng nhập
          <input name="username" required autoComplete="username" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Mật khẩu
          <input name="password" type="password" required autoComplete="current-password" className="rounded border px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
      <p className="text-sm">
        Chưa có tài khoản? <Link href="/signup" className="underline">Đăng ký</Link>
      </p>
    </main>
  );
}
