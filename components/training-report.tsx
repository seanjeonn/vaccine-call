"use client";

import {
  RISK_TAG_LABELS,
  SEVERITY_BADGE_CLASSES,
  SEVERITY_LABELS,
  SEVERITY_RING_CLASSES,
  type TrainingReport,
} from "@/lib/report";

type Message = { role: "user" | "assistant"; content: string };

type Props = {
  report: TrainingReport;
  messages: Message[];
  scenarioLabel?: string;
};

// 훈련 종료 후 분석 리포트. 진단 → 위험 순간 타임라인 → 예방 팁 순으로 보여준다.
export default function TrainingReportView({
  report,
  messages,
  scenarioLabel,
}: Props) {
  const momentByTurn = new Map(report.riskMoments.map((m) => [m.turnIndex, m]));

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
      {/* 진단 */}
      <section className="rounded-xl bg-neutral-900 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">훈련 분석 리포트</h2>
          <span
            className={
              "rounded px-2 py-0.5 text-[11px] font-medium " +
              SEVERITY_BADGE_CLASSES[report.overallRisk]
            }
          >
            위험도 {SEVERITY_LABELS[report.overallRisk]}
          </span>
        </div>
        {scenarioLabel && (
          <div className="mt-1 text-[11px] text-neutral-500">{scenarioLabel} 훈련</div>
        )}
        <p className="mt-3 text-sm font-semibold text-neutral-100">
          {report.diagnosis.vulnerabilityType}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-300">
          {report.diagnosis.summary}
        </p>
        {report.riskMoments.length === 0 && (
          <p className="mt-3 rounded-md bg-emerald-500/15 px-2 py-1.5 text-[13px] text-emerald-300">
            위험한 발화 없이 잘 대응하셨어요.
          </p>
        )}
      </section>

      {/* 대화 타임라인 — 위험 발화에 표시를 남긴다 */}
      <section className="space-y-3">
        <h3 className="text-xs font-medium text-neutral-500">통화 내용</h3>
        {messages.map((m, i) => {
          const moment = momentByTurn.get(i);
          return (
            <div key={i} className="space-y-1">
              <div
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
                    (m.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-800 text-neutral-100") +
                    (moment ? " " + SEVERITY_RING_CLASSES[moment.severity] : "")
                  }
                >
                  {m.content || "…"}
                </div>
              </div>
              {moment && (
                <div className="ml-auto max-w-[85%] rounded-lg bg-neutral-900 px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    {moment.tags.map((tag) => (
                      <span
                        key={tag}
                        className={
                          "rounded px-1.5 py-0.5 text-[10px] font-medium " +
                          SEVERITY_BADGE_CLASSES[moment.severity]
                        }
                      >
                        {RISK_TAG_LABELS[tag]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-right text-[12px] leading-relaxed text-neutral-400">
                    {moment.explanation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* 예방 팁 */}
      {report.tips.length > 0 && (
        <section className="rounded-xl bg-neutral-900 p-4">
          <h3 className="text-sm font-semibold">다음엔 이렇게 하세요</h3>
          <ol className="mt-2 space-y-2">
            {report.tips.map((tip, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-neutral-300">
                <span className="shrink-0 text-neutral-500">{i + 1}.</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
