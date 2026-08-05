// 실시간 통화 코파일럿(F3)의 공유 타입과 표시 정보.
// 서버 라우트(copilot)와 클라이언트(코파일럿 화면·자녀 대시보드 카드)에서 공유한다.
//
// 훈련 리포트(lib/report.ts)와 역할이 다르다. 리포트는 끝난 통화를 돌아보며 "무엇이 위험했는지"를
// 태그로 남기고, 여기서는 진행 중인 통화가 "사기 각본의 어디까지 왔는지"를 좇는다.

import type { Severity } from "@/lib/report";
import type { ScenarioId } from "@/lib/scenarios";

// 보이스피싱은 아래 순서로 진행된다. 근거: docs/research/financial-fraud-research.md §3
export type CopilotStage =
  | "none" // 사기 신호 없음
  | "approach" // 접근 — 기관·가족·금융사 사칭으로 신뢰 구축
  | "pressure" // 압박 — 처벌·계좌 동결·시한으로 공포 조성
  | "isolation" // 격리 — 가족과 차단, 앱 설치, 장소 이동 지시
  | "extraction"; // 송금 유도 — 안전계좌·현금 전달·상품권·OTP

export const COPILOT_STAGES: CopilotStage[] = [
  "approach",
  "pressure",
  "isolation",
  "extraction",
];

// 단계가 앞으로 나아갔는지 견주는 데 쓴다. 되돌아간 판정은 안내를 다시 띄우지 않는다.
export const stageRank = (stage: CopilotStage): number =>
  stage === "none" ? 0 : COPILOT_STAGES.indexOf(stage) + 1;

export const STAGE_LABELS: Record<CopilotStage, string> = {
  none: "안전",
  approach: "접근",
  pressure: "압박",
  isolation: "격리",
  extraction: "송금 유도",
};

// 스피커폰 한 채널에 두 사람이 섞여 들어온다. 화자 분리는 오디오가 아니라
// 분석 LLM이 내용으로 판단한다.
export type CopilotSpeaker = "caller" | "victim";
export type CopilotLine = { speaker: CopilotSpeaker; text: string };

export type CopilotScamType = ScenarioId | "unknown";

export type CopilotAnalysis = {
  lines: CopilotLine[]; // 이번에 들어온 발화의 화자 분리 결과
  stage: CopilotStage;
  risk: number; // 0~100
  scamType: CopilotScamType;
  summary: string; // 자녀 대시보드에 띄울 현재 상황 한 줄
  evidence: string; // 판정 근거가 된 상대방 발화 발췌 (없으면 빈 문자열)
};

// 이 값을 넘거나 송금 유도 단계에 들어가면 자녀에게 알린다. 통화당 한 번뿐이라
// 너무 낮게 잡으면 일반 통화에서 헛알림이 가고, 너무 높으면 이미 늦는다.
export const ALERT_RISK_THRESHOLD = 70;

// 마이크를 이 길이로 잘라 STT에 보낸다. 짧을수록 반응이 빠르지만 문장이 잘려
// 인식률이 떨어진다.
export const CHUNK_MS = 5000;

// 게이지가 오르내리며 깜빡이지 않도록 한 틱에 내려갈 수 있는 폭을 제한한다.
export const RISK_DECAY_MAX = 15;

export const riskLevel = (risk: number): Severity =>
  risk >= 70 ? "high" : risk >= 40 ? "medium" : "low";

// 개입 카드는 LLM이 쓰지 않고 단계별 고정 문안을 쓴다. 급한 순간에 읽는 글이라
// 검수된 문장이어야 하고, 5초마다 문구가 흔들리면 오히려 혼란스럽다.
export type CopilotCard = {
  headline: string;
  say: string; // 지금 할 말
  act: string; // 지금 할 행동
};

export const COPILOT_CARDS: Record<CopilotStage, CopilotCard> = {
  none: {
    headline: "아직 위험 신호는 없어요",
    say: "평소처럼 통화하세요.",
    act: "이 화면을 켜둔 채로 두시면 계속 살펴봐 드릴게요.",
  },
  approach: {
    headline: "누구인지 먼저 확인하세요",
    say: "“성함과 소속, 사무실 번호를 알려주세요. 제가 다시 걸겠습니다.”",
    act: "걸려온 번호는 믿지 마세요. 전화를 끊고 기관 대표번호를 직접 찾아 거세요.",
  },
  pressure: {
    headline: "겁주고 재촉하는 것은 사기 신호입니다",
    say: "“확인해 보고 다시 연락드리겠습니다.”",
    act: "지금 끊으셔도 아무 일도 생기지 않습니다. 진짜 기관은 전화로 재촉하지 않습니다.",
  },
  isolation: {
    headline: "비밀로 하라는 요구는 사기입니다",
    say: "“가족과 상의한 뒤에 연락드리겠습니다.”",
    act: "지금 자녀분께 이 전화를 알리세요. 앱 설치나 장소 이동 지시는 따르지 마세요.",
  },
  extraction: {
    headline: "절대 돈을 보내지 마세요",
    say: "“은행에 직접 가서 확인하겠습니다.”",
    act: "지금 바로 전화를 끊으세요. 검찰·금융감독원의 ‘안전계좌’는 존재하지 않습니다.",
  },
};

// --- 체험 모드(심사·시연용) ---
// 마이크 없이 돌아가는 기관사칭형 대본. 접근 → 압박 → 격리 → 송금 유도까지 훑는다.
// 대사는 lib/scenarios.ts의 기관사칭 시나리오와 같은 수법을 따른다.
export type SimLine = CopilotLine & { pauseMs: number };

export const SIM_SCRIPT: SimLine[] = [
  {
    speaker: "caller",
    text: "여보세요, 서울중앙지방검찰청 첨단범죄수사부 김민수 수사관입니다. 본인 확인 좀 하겠습니다.",
    pauseMs: 500,
  },
  { speaker: "victim", text: "네? 검찰청이요? 무슨 일로 전화를 주셨는지…", pauseMs: 500 },
  {
    speaker: "caller",
    text: "선생님 명의의 계좌가 대포통장으로 사용된 정황이 확인됐습니다. 사건번호 2026형제41928호입니다.",
    pauseMs: 500,
  },
  { speaker: "victim", text: "저는 그런 적이 없는데요. 뭔가 잘못된 것 같은데요.", pauseMs: 500 },
  {
    speaker: "caller",
    text: "지금 협조하지 않으시면 공범으로 간주되어 구속영장이 청구됩니다. 오늘 안에 정리해야 합니다.",
    pauseMs: 500,
  },
  { speaker: "victim", text: "구속이요? 아이고, 어떻게 해야 하나요…", pauseMs: 500 },
  {
    speaker: "caller",
    text: "이건 수사 기밀이라 가족을 포함해 누구에게도 말씀하시면 안 됩니다. 발설하면 공무집행방해로 처벌됩니다.",
    pauseMs: 500,
  },
  { speaker: "victim", text: "아들한테도 말하면 안 되는 건가요?", pauseMs: 500 },
  {
    speaker: "caller",
    text: "안 됩니다. 그리고 전화를 끊지 마시고 제가 안내하는 대로만 움직이세요. 지금 은행으로 가실 수 있습니까?",
    pauseMs: 500,
  },
  { speaker: "victim", text: "네, 지금 나가면 됩니다.", pauseMs: 500 },
  {
    speaker: "caller",
    text: "선생님 자산을 보호해야 하니 금융감독원 안전계좌로 전액 이체하셔야 합니다. 계좌번호 불러드리겠습니다.",
    pauseMs: 500,
  },
  { speaker: "victim", text: "얼마를 보내면 되나요? 지금 이체하겠습니다.", pauseMs: 500 },
];

// 체험 모드에서 어르신 대사를 읽을 목소리.
export const SIM_VICTIM_VOICE = {
  voice: "sage",
  ttsInstructions:
    "60대 후반 여성이 놀라고 당황한 목소리로, 조심스럽고 느리게 말하세요.",
};
