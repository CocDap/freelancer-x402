"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "../auth-card";

export default function LoginPage() {
  const router = useRouter();

  async function submit(form: FormData) {
    const { error } = await authClient.signIn.username({
      username: String(form.get("username")),
      password: String(form.get("password")),
    });
    if (error) return "Tên đăng nhập hoặc mật khẩu không đúng.";
    router.push("/search");
    router.refresh();
    return null;
  }

  return (
    <AuthCard
      title="Đăng nhập"
      description="Tìm freelancer bằng AI và thuê qua escrow USDC."
      passwordLabel="Mật khẩu"
      passwordAutoComplete="current-password"
      submitLabel="Đăng nhập"
      pendingLabel="Đang đăng nhập..."
      footer={{ text: "Chưa có tài khoản?", href: "/signup", link: "Đăng ký" }}
      submit={submit}
    />
  );
}
