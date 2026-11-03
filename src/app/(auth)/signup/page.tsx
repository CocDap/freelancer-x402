"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username")).trim();
    setPending(true);
    setError(null);
    // better-auth requires an email; use a synthetic one that is never shown.
    const { error } = await authClient.signUp.email({
      email: `${username}@users.invalid`,
      name: username,
      username,
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      setError(
        error.status === 403
          ? "Đã có tài khoản. Công cụ này chỉ cho phép một người dùng."
          : "Đăng ký không thành công. Mật khẩu cần ít nhất 8 ký tự.",
      );
      return;
    }
    router.push("/search");
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Đăng ký</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Tên đăng nhập
          <input name="username" required autoComplete="username" className="rounded border px-3 py-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Mật khẩu (tối thiểu 8 ký tự)
          <input name="password" type="password" required minLength={8} autoComplete="new-password" className="rounded border px-3 py-2" />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? "Đang đăng ký..." : "Đăng ký"}
        </button>
      </form>
      <p className="text-sm">
        Đã có tài khoản? <Link href="/login" className="underline">Đăng nhập</Link>
      </p>
    </main>
  );
}
