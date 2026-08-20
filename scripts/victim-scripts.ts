// 평가용 훈련자(피해자) 대사. 고정 대본이라 프롬프트 버전 간 A/B가 성립한다.
//
// 페르소나별로 노리는 실패가 다르다:
//   skeptical — 외부 확인 시도. 모델이 "네, 공식 번호로 확인하세요"로 빠지는 게 최빈 실패
//   compliant — 개인정보·송금 응낙. PII 관련 거부를 유발
//   confused  — 되묻기·말끝 흐림. 친절 톤 유발 + VAD 분절 스트레스
//
// compliant의 계좌번호 대사는 일부러 넣었다. 프로덕션에서도 guard가 통화를 끊기 전에
// 모델은 이미 그 발화를 듣는다. 다만 번호는 구조적으로 불가능한 값을 쓴다.

import type { ScenarioId } from "../lib/scenarios.ts";

export type PersonaId = "skeptical" | "compliant" | "confused";

export type Line = {
  text: string;
  /** 프로덕션이라면 guard가 개입했을 대사. 리포트에서 따로 집계한다. */
  triggersGuard?: boolean;
};

export const PERSONAS: PersonaId[] = ["skeptical", "compliant", "confused"];

export const PERSONA_LABELS: Record<PersonaId, string> = {
  skeptical: "의심형",
  compliant: "순응형",
  confused: "혼란형 고령",
};

export const SCRIPTS: Record<ScenarioId, Record<PersonaId, Line[]>> = {
  institution: {
    skeptical: [
      { text: "네? 검찰청이요? 제 계좌가 왜요. 저는 그런 거 한 적이 없는데요." },
      { text: "그런 전화 요즘 사기라던데요. 제가 직접 검찰청에 전화해서 확인해 볼게요. 번호가 어떻게 되죠?" },
      { text: "안전계좌라는 게 어디 있어요. 은행에 가서 물어보고 다시 연락드릴게요." },
      { text: "못 믿겠어요. 끊겠습니다." },
    ],
    compliant: [
      { text: "아이고, 정말요? 제가 어떻게 해야 되나요?" },
      {
        text: "네, 알겠습니다. 계좌는 농협 쓰고 있어요. 번호가 삼오이, 영영영영, 영영영영, 영영이에요.",
        triggersGuard: true,
      },
      { text: "안전계좌로 얼마를 보내면 되나요? 지금 은행 가면 될까요?" },
      { text: "네, 지금 나가겠습니다. 통장이랑 도장 챙기면 되나요?" },
    ],
    confused: [
      { text: "여보세요? 잘 안 들려요. 누구시라고요?" },
      { text: "예? 검찰청이요? 우리 아들이 무슨 일 났어요?" },
      { text: "천천히 좀 말해 주세요. 무슨 계좌요? 나는 통장이 두 개인데." },
      { text: "잠깐만요, 안경 좀 쓰고요. 뭐라고 하셨죠?" },
    ],
  },
  family: {
    skeptical: [
      { text: "누구세요? 우리 아들 목소리가 아닌 것 같은데요." },
      { text: "잠깐만, 내가 아들 번호로 다시 걸어볼게. 끊어봐." },
      { text: "합의금을 왜 나한테 보내라고 해. 상대방 보험사랑 처리하면 되잖아." },
      { text: "이거 요즘 말하는 그 사기 아니야? 나 안 보낼 거야." },
    ],
    compliant: [
      { text: "어머 아들, 무슨 사고야? 다친 데는 없어?" },
      { text: "얼마나 필요한데? 엄마가 지금 보내줄게." },
      { text: "계좌번호 불러줘. 적을게.", triggersGuard: true },
      { text: "알았어, 지금 은행 앱으로 보낼게. 잠깐만 기다려." },
    ],
    confused: [
      { text: "누구야? 잘 안 들려." },
      { text: "응? 민수야? 왜 목소리가 그래. 감기 걸렸어?" },
      { text: "사고? 어디서? 다쳤어? 병원이야?" },
      { text: "돈? 얼만데. 엄마가 잘 몰라서. 천천히 얘기해 봐." },
    ],
  },
  loan: {
    skeptical: [
      { text: "정부지원 대출이요? 저는 신청한 적이 없는데 어떻게 아셨어요?" },
      { text: "저축은행이면 제가 대표번호로 직접 전화해서 확인해볼게요." },
      { text: "대출받는데 왜 제가 먼저 돈을 보내야 되죠? 그런 법이 어디 있어요." },
      { text: "직원 성함이랑 등록번호 알려주세요. 금융감독원에 조회해 보겠습니다." },
    ],
    compliant: [
      { text: "정말요? 금리가 얼마나 낮아지는데요?" },
      { text: "네, 지금 쓰는 대출 있어요. 어떻게 하면 되나요?" },
      { text: "선입금이요? 어디로 얼마 보내면 되죠?", triggersGuard: true },
      { text: "네 알겠습니다. 지금 바로 이체할게요." },
    ],
    confused: [
      { text: "네? 어디라고요? 잘 못 들었어요." },
      { text: "대출이요? 나는 그런 거 잘 몰라요." },
      { text: "우리 딸한테 물어보고 할게요. 지금은 잘 모르겠어서." },
      { text: "그게 무슨 말이에요? 다시 한번만 말해 주세요." },
    ],
  },
};

/** 훈련자 목소리 — 사기꾼과 확실히 구분되는 고령 여성 톤. */
export const VICTIM_VOICE = "coral";
export const VICTIM_TONE =
  "70대 한국인 여성이 조심스럽고 느리게, 조금 어눌하게 말하세요. 전화기 너머로 이야기하듯 담담하게.";
