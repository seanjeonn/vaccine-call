// 훈련 종료 후 AI 분석 리포트(F1-3)의 공유 타입과 표시 정보.
// 서버 라우트(report)와 클라이언트(리포트 뷰)에서 공유한다.

// 위험 태그는 고정 4종. LLM이 자유 서술 대신 이 중에서만 고르게 해 UI 표시를 안정시킨다.
export type RiskTagId =
  | "personal_info" // 개인정보 노출
  | "money_compliance" // 금전 요구 순응
  | "instruction_compliance" // 지시 이행
  | "psychological_shaken"; // 심리적 동요

export type Severity = "low" | "medium" | "high";

export type RiskMoment = {
  turnIndex: number; // 전체 대화 배열의 인덱스 (사용자 발화만)
  tags: RiskTagId[];
  severity: Severity;
  quote: string; // 해당 발화에서 발췌
  explanation: string; // 왜 위험한지 1~2문장
};

export type TrainingReport = {
  overallRisk: Severity;
  riskMoments: RiskMoment[];
  diagnosis: { vulnerabilityType: string; summary: string };
  tips: string[];
};

export const RISK_TAG_IDS: RiskTagId[] = [
  "personal_info",
  "money_compliance",
  "instruction_compliance",
  "psychological_shaken",
];

export const RISK_TAG_LABELS: Record<RiskTagId, string> = {
  personal_info: "개인정보 노출",
  money_compliance: "금전 요구 순응",
  instruction_compliance: "지시 이행",
  psychological_shaken: "심리적 동요",
};

// LLM 프롬프트에 넣을 태그 정의. 판정 기준을 라벨과 한곳에서 관리한다.
export const RISK_TAG_CRITERIA: Record<RiskTagId, string> = {
  personal_info:
    "주민등록번호·계좌번호·비밀번호·카드정보 등 개인정보나 금융정보를 말했다.",
  money_compliance:
    "송금·현금 인출·상품권 구매 등 금전 요구에 동의하거나 이행 의사를 밝혔다.",
  instruction_compliance:
    "앱 설치·특정 장소 이동·가족에게 비밀 유지 등 상대의 지시를 따르겠다고 했다.",
  psychological_shaken:
    "겁을 먹거나 다급해져 판단력을 잃은 반응을 보였다(사과·애원·무조건적 신뢰 등).",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "낮음",
  medium: "주의",
  high: "높음",
};

export const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  low: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-red-500/15 text-red-300",
};

export const SEVERITY_RING_CLASSES: Record<Severity, string> = {
  low: "ring-2 ring-emerald-500/60",
  medium: "ring-2 ring-amber-500/60",
  high: "ring-2 ring-red-500/70",
};
