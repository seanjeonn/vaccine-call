"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGE_GROUPS } from "@/lib/parent";

// 부모가 처음 만나는 화면. 고령자 기준으로 글씨와 터치 영역을 크게 잡는다.
export default function InviteAcceptForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [ageGroup, setAgeGroup] = useState<string>(AGE_GROUPS[1]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, ageGroup }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "연결에 실패했습니다.");
      router.push("/p");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "연결에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <label className="flex flex-col gap-2 text-xl">
        어떻게 불러드릴까요?
        <input
          type="text"
          required
          maxLength={20}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 김영자"
          className="rounded-xl border-2 border-neutral-600 bg-neutral-900 px-4 py-4 text-2xl"
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-xl">
        <legend className="mb-2">연세가 어떻게 되시나요?</legend>
        <div className="flex flex-col gap-2">
          {AGE_GROUPS.map((group) => (
            <label
              key={group}
              className={
                "flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-4 text-2xl " +
                (ageGroup === group
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-neutral-700")
              }
            >
              <input
                type="radio"
                name="ageGroup"
                value={group}
                checked={ageGroup === group}
                onChange={() => setAgeGroup(group)}
                className="h-6 w-6"
              />
              {group}
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-emerald-600 py-6 text-2xl font-bold text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "연결 중…" : "시작하기"}
      </button>
    </form>
  );
}
