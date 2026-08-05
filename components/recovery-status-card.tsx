import {
  METHOD_LABELS,
  buildTimeline,
  nextStep,
  stepsFor,
  type DamageMethod,
} from "@/lib/recovery";

export type RecoveryCaseSummary = {
  id: string;
  parentName: string;
  method: DamageMethod;
  incidentAt: Date;
  stepsDone: string[];
  hasDocuments: boolean;
};

// 자녀 대시보드의 피해 구제 진행 현황(F4-1). 단계마다 알림을 보내는 대신
// 여기서 진행 상황을 한눈에 보여준다.
export default function RecoveryStatusCard({
  summary,
  now,
}: {
  summary: RecoveryCaseSummary;
  now: Date;
}) {
  const steps = stepsFor(summary.method);
  const upcoming = nextStep(summary.method, summary.stepsDone);
  const deadline = buildTimeline(
    summary.method,
    summary.incidentAt,
    summary.stepsDone,
    now,
  ).find((item) => item.state === "next");

  return (
    <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
          피해 구제 진행 중
        </span>
        <span className="text-sm font-semibold">{summary.parentName}님</span>
      </div>

      <p className="mt-2 text-sm text-neutral-300">
        {METHOD_LABELS[summary.method]} 피해 ·{" "}
        {summary.incidentAt.toLocaleDateString("ko-KR")} 발생 · {steps.length}단계 중{" "}
        {summary.stepsDone.length}단계 완료
      </p>

      <div className="mt-2 flex gap-1">
        {steps.map((step) => (
          <span
            key={step.id}
            className={
              "h-1.5 flex-1 rounded-full " +
              (summary.stepsDone.includes(step.id) ? "bg-emerald-500" : "bg-neutral-700")
            }
          />
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-neutral-400">
        {upcoming ? `다음 할 일: ${upcoming.title}` : "필요한 절차를 모두 마쳤습니다."}
      </p>

      {deadline && (
        <p className="mt-1 text-sm font-medium text-amber-300">
          {deadline.label} 기한 {deadline.dateLabel} · {deadline.note}
        </p>
      )}

      <p className="mt-1 text-xs text-neutral-500">
        서류 초안 {summary.hasDocuments ? "작성 완료" : "아직 미작성"}
      </p>
    </div>
  );
}
