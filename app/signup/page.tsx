import type { Metadata } from "next";
import AuthForm from "@/components/auth-form";

export const metadata: Metadata = { title: "보호자 가입 · 백신콜" };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
