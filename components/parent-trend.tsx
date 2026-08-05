import {
  RISK_TAG_LABELS,
  SEVERITY_BADGE_CLASSES,
  SEVERITY_LABELS,
  compareRisk,
  type RiskTagId,
  type RiskTrend,
  type Severity,
} from "@/lib/report";

export type TrendRound = {
  id: string;
  scenarioLabel: string;
  overallRisk: Severity;
  riskMomentCount: number;
  dateLabel: string;
};

type Props = {
  name: string;
  rounds: TrendRound[]; // 오래된 회차부터
  recurring: { tag: RiskTagId; count: number }[];
};

const TREND_TEXT: Record<RiskTrend, string> = {
  improved: "지난번보다 개선",
  worse: "지난번보다 악화",
  same: "지난번과 비슷",
};

const TREND_CLASSES: Record<RiskTrend, string> = {
  improved: "bg-emerald-500/15 text-emerald-300",
  worse: "bg-red-500/15 text-red-300",
  same: "bg-neutral-700/40 text-neutral-300",
};

// 부모 한 명의 회차별 위험도 추이 (F1-5). 2회차 이상일 때만 쓰인다.
export default function ParentTrend({ name, rounds, recurring }: Props) {
  const latest = rounds[rounds.length - 1];
  const trend = compareRisk(rounds[rounds.length - 2].overallRisk, latest.overallRisk);

  return (
    <li className="rounded-lg border border-neutral-800 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{name}</span>
        <span
          className={"shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " + TREND_CLASSES[trend]}
        >
          {TREND_TEXT[trend]}
        </span>
      </div>

      <ol className="mt-3 space-y-1.5">
        {rounds.map((round, i) => (
          <li key={round.id} className="flex items-center gap-2 text-xs">
            <span className="w-10 shrink-0 text-neutral-500">{i + 1}회차</span>
            <span
              className={
                "shrink-0 rounded px-2 py-0.5 font-medium " +
                SEVERITY_BADGE_CLASSES[round.overallRisk]
              }
            >
              {SEVERITY_LABELS[round.overallRisk]}
            </span>
            <span className="truncate text-neutral-400">{round.scenarioLabel}</span>
            <span className="ml-auto shrink-0 text-neutral-500">
              위험 발화 {round.riskMomentCount}건 · {round.dateLabel}
            </span>
          </li>
        ))}
      </ol>

      {recurring.length > 0 && (
        <p className="mt-3 text-xs text-amber-300">
          반복 주의:{" "}
          {recurring.map((r) => `${RISK_TAG_LABELS[r.tag]} ×${r.count}`).join(", ")}
        </p>
      )}
    </li>
  );
}
