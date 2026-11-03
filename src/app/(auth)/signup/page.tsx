"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "../auth-card";

export default function SignupPage() {
  const router = useRouter();

  async function submit(form: FormData) {
    const username = String(form.get("username")).trim();
    // better-auth requires an email; use a synthetic one that is never shown.
    const { error } = await authClient.signUp.email({
      email: `${username}@users.invalid`,
      name: username,
      username,
      password: String(form.get("password")),
    });
    if (error) {
      return error.status === 403
        ? "Đã có tài khoản. Công cụ này chỉ cho phép một người dùng."
        : "Đăng ký không thành công. Mật khẩu cần ít nhất 8 ký tự.";
    }
    router.push("/search");
    router.refresh();
    return null;
  }

  return (
    <AuthCard
      title="Đăng ký"
      description="Công cụ dành cho một người dùng. Ví USDC được tạo tự động cho bạn."
      passwordLabel="Mật khẩu (tối thiểu 8 ký tự)"
      passwordAutoComplete="new-password"
      minLength={8}
      submitLabel="Đăng ký"
      pendingLabel="Đang đăng ký..."
      footer={{ text: "Đã có tài khoản?", href: "/login", link: "Đăng nhập" }}
      submit={submit}
    />
  );
}
