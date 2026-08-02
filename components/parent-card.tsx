"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGE_GROUPS } from "@/lib/parent";

type Props = {
  id: string;
  name: string;
  ageGroup: string;
  reportCount: number;
  lastTrainedAt: string | null;
};

// 부모 한 명. 이름·연령대 수정이 여기서 끝난다 (F2-4).
export default function ParentCard({
  id,
  name,
  ageGroup,
  reportCount,
  lastTrainedAt,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftAge, setDraftAge] = useState(ageGroup);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/parents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName, ageGroup: draftAge }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "저장하지 못했습니다.");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-neutral-700 p-4">
        <form onSubmit={save} className="flex flex-col gap-3">
          <input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={20}
            required
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <select
            value={draftAge}
            onChange={(e) => setDraftAge(e.target.value)}
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >
            {AGE_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraftName(name);
                setDraftAge(ageGroup);
                setError(null);
              }}
              className="rounded border border-neutral-600 px-3 py-1.5 text-sm text-neutral-300"
            >
              취소
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 px-4 py-3">
      <div>
        <span className="font-medium">{name}</span>
        <span className="ml-2 text-sm text-neutral-400">{ageGroup}</span>
        <p className="mt-0.5 text-xs text-neutral-500">
          훈련 {reportCount}회
          {lastTrainedAt && ` · 최근 ${lastTrainedAt}`}
        </p>
      </div>
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
      >
        수정
      </button>
    </li>
  );
}
