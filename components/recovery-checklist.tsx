"use client";

import { useState } from "react";
import Link from "next/link";
import {
  nextStep,
  stepsFor,
  type DamageMethod,
  type RecoveryStep,
  type StepId,
  type TimelineItem,
} from "@/lib/recovery";

// 서버에서 계산한 타임라인을 그대로 받는다 — 서버·클라이언트 시각 차이로
// D-day가 흔들리는 것을 막으려는 목적.
export default function RecoveryChecklist({
  method,
  initialStepsDone,
  timeline,
  hasDocuments,
}: {
  method: DamageMethod;
  initialStepsDone: StepId[];
  timeline: TimelineItem[];
  hasDocuments: boolean;
}) {
  const [stepsDone, setStepsDone] = useState<string[]>(initialStepsDone);
  const [error, setError] = useState<string | null>(null);
  const steps = stepsFor(method);
  const upcoming = nextStep(method, stepsDone);
  const done = stepsDone.length;

  async function toggle(stepId: StepId, next: boolean) {
    const before = stepsDone;
    setStepsDone(next ? [...new Set([...before, stepId])] : before.filter((id) => id !== stepId));
    setError(null);
    try {
      const res = await fetch("/api/recovery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, done: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setStepsDone(before);
      setError("저장하지 못했어요. 잠시 뒤 다시 눌러주세요.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-3xl font-bold leading-snug">피해 구제 절차</h1>
        <p className="mt-2 text-xl text-neutral-400">
          {steps.length}가지 중 {done}가지를 마치셨어요.
        </p>
      </header>

      {upcoming ? (
        <section className="rounded-3xl bg-red-500/10 p-6 ring-2 ring-red-500/50">
          <p className="text-lg font-bold text-red-300">지금 하실 일</p>
          <h2 className="mt-2 text-2xl font-bold leading-snug">{upcoming.title}</h2>
          <p className="mt-3 text-lg leading-relaxed text-neutral-300">
            {upcoming.description}
          </p>
          <StepActionButton step={upcoming} big />
        </section>
      ) : (
        <section className="rounded-3xl bg-emerald-500/10 p-6 text-center ring-2 ring-emerald-500/50">
          <h2 className="text-2xl font-bold text-emerald-300">할 일을 모두 마치셨어요</h2>
          <p className="mt-2 text-lg text-neutral-300">
            이제 은행과 경찰의 연락을 기다리시면 됩니다. 궁금한 점은 아래 사무장에게
            물어보세요.
          </p>
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-neutral-300">전체 순서</h2>
        {steps.map((step, index) => {
          const checked = stepsDone.includes(step.id);
          return (
            <div
              key={step.id}
              className={
                "rounded-2xl border-2 px-5 py-5 transition " +
                (checked ? "border-emerald-700/60 bg-emerald-500/5" : "border-neutral-700")
              }
            >
              <div className="flex items-start gap-3">
                <span
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-bold " +
                    (checked ? "bg-emerald-600 text-white" : "bg-neutral-800 text-neutral-300")
                  }
                >
                  {checked ? "✓" : index + 1}
                </span>
                <div className="min-w-0">
                  <h3
                    className={
                      "text-xl font-bold leading-snug " + (checked ? "text-neutral-500" : "")
                    }
                  >
                    {step.title}
                  </h3>
                  {!checked && (
                    <p className="mt-2 text-lg leading-relaxed text-neutral-400">
                      {step.description}
                    </p>
                  )}
                </div>
              </div>

              {!checked && <StepActionButton step={step} />}

              <button
                type="button"
                onClick={() => toggle(step.id, !checked)}
                className={
                  "mt-3 w-full rounded-xl py-4 text-xl font-bold transition " +
                  (checked
                    ? "text-neutral-500 underline"
                    : "bg-neutral-800 hover:bg-neutral-700")
                }
              >
                {checked ? "아직 못 했어요" : "했어요"}
              </button>
            </div>
          );
        })}
      </section>

      {timeline.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-bold text-neutral-300">앞으로의 일정</h2>
          {timeline.map((item) => (
            <div
              key={item.label}
              className={
                "rounded-2xl border-2 px-5 py-4 " +
                (item.state === "next"
                  ? "border-amber-500/60 bg-amber-500/10"
                  : "border-neutral-800")
              }
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xl font-bold">{item.label}</span>
                <span className="shrink-0 text-lg text-neutral-400">{item.dateLabel}</span>
              </div>
              <p
                className={
                  "mt-1 text-lg leading-relaxed " +
                  (item.state === "next" ? "text-amber-200" : "text-neutral-400")
                }
              >
                {item.note}
              </p>
            </div>
          ))}
        </section>
      )}

      {hasDocuments && (
        <Link
          href="/p/recovery/print"
          className="rounded-full border-2 border-neutral-600 py-5 text-center text-xl font-bold transition hover:border-neutral-400"
        >
          만들어 둔 서류 보기
        </Link>
      )}

      <p className="px-1 text-center text-base leading-relaxed text-neutral-500">
        절차는 바뀔 수 있습니다. 확실하지 않은 것은 112 또는 금융감독원 1332에 확인하세요.
      </p>
    </div>
  );
}

// 전화·외부 링크·앱 내부 이동을 한 버튼 모양으로 낸다.
function StepActionButton({ step, big = false }: { step: RecoveryStep; big?: boolean }) {
  const className =
    "mt-4 block rounded-full text-center font-bold transition " +
    (big
      ? "bg-red-600 py-6 text-2xl text-white hover:bg-red-500"
      : "bg-emerald-600 py-4 text-xl text-white hover:bg-emerald-500");

  if (step.action.kind === "internal") {
    return (
      <Link href={step.action.href} className={className}>
        {step.action.label}
      </Link>
    );
  }

  return (
    <a
      href={step.action.href}
      target={step.action.kind === "link" ? "_blank" : undefined}
      rel={step.action.kind === "link" ? "noreferrer" : undefined}
      className={className}
    >
      {step.action.label}
    </a>
  );
}
