"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { METHOD_LABELS, type DamageMethod } from "@/lib/recovery";

const METHODS: { id: DamageMethod; label: string; hint: string }[] = [
  { id: "transfer", label: "계좌로 이체했어요", hint: "은행 앱이나 창구에서 송금" },
  { id: "cash", label: "현금을 직접 건넸어요", hint: "만나서 전달하거나 문 앞에 둠" },
  { id: "giftcard", label: "상품권 번호를 알려줬어요", hint: "문화상품권·구글기프트카드 등" },
];

const WHENS = [
  { label: "오늘이요", days: 0 },
  { label: "어제요", days: 1 },
  { label: "그 전이에요", days: 2 },
];

// 사건 시작 문답. 피해 유형은 체크리스트를, 피해 시각은 서면 신청 기한을 결정한다.
export default function RecoveryStart() {
  const router = useRouter();
  const [method, setMethod] = useState<DamageMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(days: number) {
    if (!method) return;
    setError(null);
    setBusy(true);
    try {
      // 며칠 전인지만 보내고 시각은 서버가 정한다. 기한 계산의 기준 시계를 하나로 두려는 목적.
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, daysAgo: days }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "시작하지 못했습니다.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "시작하지 못했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold leading-snug">
          괜찮습니다.
          <br />
          지금부터 함께 해요.
        </h1>
        <p className="mt-3 text-xl leading-relaxed text-neutral-400">
          빨리 움직이면 돈을 돌려받을 수 있습니다. 제가 하나씩 알려드릴게요.
        </p>
      </header>

      {!method ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold">어떻게 보내셨나요?</h2>
          {METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setMethod(item.id)}
              className="rounded-2xl border-2 border-neutral-700 px-5 py-5 text-left transition hover:border-neutral-500"
            >
              <span className="block text-2xl font-bold">{item.label}</span>
              <span className="mt-1 block text-lg text-neutral-400">{item.hint}</span>
            </button>
          ))}
        </section>
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-bold">언제 보내셨나요?</h2>
          <p className="text-lg text-neutral-400">
            {METHOD_LABELS[method]} 피해로 확인했어요. 서류를 내야 하는 기한을 계산하는 데
            필요합니다.
          </p>
          {WHENS.map((item) => (
            <button
              key={item.days}
              type="button"
              disabled={busy}
              onClick={() => start(item.days)}
              className="rounded-2xl bg-neutral-800 px-5 py-6 text-2xl font-bold transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            disabled={busy}
            onClick={() => setMethod(null)}
            className="mt-2 text-lg text-neutral-500 underline"
          >
            다시 고르기
          </button>
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
      )}
    </div>
  );
}
