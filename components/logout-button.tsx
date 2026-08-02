"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
      className="text-sm text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
    >
      로그아웃
    </button>
  );
}
