"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AGE_GROUPS, BANKS, FAMILY_OPTIONS } from "@/lib/parent";

type Props = {
  id: string;
  name: string;
  ageGroup: string;
  bank: string | null;
  family: string | null;
  reportCount: number;
  lastTrainedAt: string | null;
};

// 부모 한 명. 이름·연령대 수정이 여기서 끝난다 (F2-4).
// 주거래 은행·가족 구성은 맞춤 시나리오 생성에 쓰이며, 부모 대신 자녀가 골라준다 (F1-1).
export default function ParentCard({
  id,
  name,
  ageGroup,
  bank,
  family,
  reportCount,
  lastTrainedAt,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftAge, setDraftAge] = useState(ageGroup);
  const [draftBank, setDraftBank] = useState(bank ?? "");
  const [draftFamily, setDraftFamily] = useState(family ?? "");
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
        body: JSON.stringify({
          name: draftName,
          ageGroup: draftAge,
          bank: draftBank,
          family: draftFamily,
        }),
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
          <label className="text-xs text-neutral-400">
            주거래 은행
            <select
              value={draftBank}
              onChange={(e) => setDraftBank(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            >
              <option value="">선택 안 함</option>
              {BANKS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-400">
            가족 구성 — 사기범이 사칭할 수 있는 가족
            <select
              value={draftFamily}
              onChange={(e) => setDraftFamily(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            >
              <option value="">선택 안 함</option>
              {FAMILY_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-relaxed text-neutral-500">
            골라두시면 훈련 전화가 부모님 상황에 맞게 만들어집니다. 비워두면 기본 시나리오로
            훈련합니다.
          </p>
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
                setDraftBank(bank ?? "");
                setDraftFamily(family ?? "");
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
        <p className="mt-0.5 text-xs text-neutral-500">
          {bank || family
            ? `맞춤 훈련 · ${[bank, family].filter(Boolean).join(" · ")}`
            : "맞춤 정보 없음 · 수정에서 은행·가족 구성을 골라주세요"}
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
