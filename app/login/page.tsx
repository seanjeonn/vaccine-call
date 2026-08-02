import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";

export const metadata: Metadata = { title: "보호자 로그인 · 백신콜" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
