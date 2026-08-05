"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Props = { mode: "signup" | "login" };

// 가입·로그인은 입력과 문구만 다르므로 한 컴포넌트로 처리한다.
export default function AuthForm({ mode }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "요청에 실패했습니다.");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "요청에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">
          {isSignup ? "보호자 가입" : "보호자 로그인"}
        </h1>
        <p className="mt-1 text-sm text-neutral-400">
          부모님은 가입하지 않습니다. 가입 후 초대 링크를 보내주세요.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm">
          이메일
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-base"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          비밀번호
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-base"
          />
          {isSignup && <span className="text-xs text-neutral-500">8자 이상</span>}
        </label>

        {error && (
          <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-emerald-600 py-3 text-base font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "처리 중…" : isSignup ? "가입하기" : "로그인"}
        </button>
      </form>

      <p className="text-center text-sm text-neutral-400">
        {isSignup ? "이미 계정이 있으신가요? " : "계정이 없으신가요? "}
        <Link
          href={isSignup ? "/login" : "/signup"}
          className="text-emerald-400 underline underline-offset-2"
        >
          {isSignup ? "로그인" : "가입하기"}
        </Link>
      </p>
    </main>
  );
}
