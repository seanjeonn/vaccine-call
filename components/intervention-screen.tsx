"use client";

import { RISK_TAG_LABELS, SEVERITY_BADGE_CLASSES, type RiskTagId } from "@/lib/report";

export type Interruption = {
  tag: RiskTagId;
  quote: string;
  consequence: string;
};

// 훈련 중 개입 화면(F1-4). 결정적으로 속은 순간에 통화를 끊고 바로 보여준다.
// 다음 단계(리포트 보기)는 통화 화면 하단 버튼이 맡는다.
export default function InterventionScreen({
  interruption,
}: {
  interruption: Interruption;
}) {
  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-6">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-600/20">
          <span className="text-4xl">✋</span>
        </div>
        <h2 className="mt-4 text-xl font-bold text-neutral-100">이건 훈련이었어요</h2>
        <p className="mt-2 text-sm text-neutral-400">
          실제 사기 전화가 아닙니다. 위험한 순간이어서 통화를 여기서 멈췄어요.
        </p>
      </div>

      <section className="rounded-xl bg-neutral-900 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-200">방금 이렇게 말씀하셨어요</h3>
          <span
            className={
              "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " +
              SEVERITY_BADGE_CLASSES.high
            }
          >
            {RISK_TAG_LABELS[interruption.tag]}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-neutral-100">
          “{interruption.quote}”
        </p>
      </section>

      <section className="rounded-xl bg-red-500/10 p-4">
        <h3 className="text-sm font-semibold text-red-300">실제였다면</h3>
        <p className="mt-2 text-sm leading-relaxed text-neutral-200">
          {interruption.consequence}
        </p>
      </section>

      <p className="px-1 text-xs leading-relaxed text-neutral-500">
        실제로 이런 전화를 받으시면 바로 끊고, 112 또는 1332로 확인하세요.
      </p>
    </div>
  );
}
