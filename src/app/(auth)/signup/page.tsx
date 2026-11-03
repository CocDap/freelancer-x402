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
      // The synthetic email mirrors the username, so a taken name can surface as either code.
      return error.code === "USERNAME_IS_ALREADY_TAKEN" || error.code?.startsWith("USER_ALREADY_EXISTS")
        ? "Tên đăng nhập đã có người dùng. Hãy chọn tên khác."
        : "Đăng ký không thành công. Mật khẩu cần ít nhất 8 ký tự.";
    }
    router.push("/search");
    router.refresh();
    return null;
  }

  return (
    <AuthCard
      title="Đăng ký"
      description="Mỗi tài khoản có một ví USDC riêng, được tạo tự động."
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
