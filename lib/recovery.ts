// 피해구제 AI 사무장(F4)의 공유 도메인. 절차 지식·체크리스트·데드라인 계산을
// 한곳에 모아 서버 라우트와 화면이 같은 사실을 쓰게 한다.
//
// 절차 근거 (2026-08 조사):
// - 통신사기피해환급법 제3조·시행령 제3조: 전화 신청 후 3영업일 내 서면 제출
// - 같은 법 제9조(공고 2개월 후 채권 소멸)·제10조(소멸 후 14일 내 환급 결정)
// - 2023.9 전기통신금융사기 통합신고대응센터 개소로 112 신고 일원화
// - 대면편취형은 2023.11 시행 개정으로 환급법 대상에 포함(지급정지는 수사기관 주도)
// - 상품권형은 계좌 송금이 아니어서 지급정지·환급 대상이 아니다

export type DamageMethod = "transfer" | "cash" | "giftcard";

export const METHOD_LABELS: Record<DamageMethod, string> = {
  transfer: "계좌이체",
  cash: "현금 전달",
  giftcard: "상품권",
};

export const isDamageMethod = (value: unknown): value is DamageMethod =>
  value === "transfer" || value === "cash" || value === "giftcard";

export type StepId =
  | "report112" // 112 신고 + 지급정지
  | "giftcardStop" // 상품권 발행사 사용정지
  | "policeDoc" // 경찰서 사건사고사실확인원
  | "documents" // 서류 만들기 (F4-2로 연결)
  | "msafer" // 명의도용 확인·차단
  | "accountInfo"; // 내 계좌 일괄지급정지

// 전화·외부 링크·앱 내부 이동을 한 가지 모양으로 다룬다.
export type StepAction = {
  kind: "tel" | "link" | "internal";
  href: string;
  label: string;
};

export type RecoveryStep = {
  id: StepId;
  title: string;
  description: string;
  action: StepAction;
};

const MSAFER: RecoveryStep = {
  id: "msafer",
  title: "내 이름으로 휴대폰이 열렸는지 확인하세요",
  description:
    "엠세이퍼에서 가입 내역을 보고 신규 가입을 막을 수 있어요. 개인정보를 알려주셨다면 금융감독원 개인정보노출자 등록(pd.fss.or.kr)도 함께 하세요.",
  action: { kind: "link", href: "https://www.msafer.or.kr", label: "엠세이퍼 열기" },
};

const ACCOUNT_INFO: RecoveryStep = {
  id: "accountInfo",
  title: "남은 내 계좌도 잠가두세요",
  description:
    "어카운트인포에서 내 계좌를 한 번에 지급정지할 수 있어요. 새 대출이 나가지 않게 하는 '여신거래 안심차단'은 은행 창구에서 신청하세요.",
  action: { kind: "link", href: "https://www.payinfo.or.kr", label: "어카운트인포 열기" },
};

const POLICE_DOC: RecoveryStep = {
  id: "policeDoc",
  title: "경찰서에 가서 신고 서류를 받으세요",
  description:
    "가까운 경찰서에서 정식으로 신고하고 '사건사고사실확인원'을 발급받으세요. 은행에 서류를 낼 때 함께 필요합니다.",
  action: { kind: "tel", href: "tel:112", label: "112 전화 걸기" },
};

const CHECKLISTS: Record<DamageMethod, RecoveryStep[]> = {
  transfer: [
    {
      id: "report112",
      title: "지금 바로 112에 전화해 지급정지를 요청하세요",
      description:
        "112 한 통이면 신고와 지급정지가 함께 처리됩니다. 돈을 보낸 은행 고객센터에도 직접 전화해두면 더 확실해요. 잘 모르겠으면 금융감독원 1332에 물어보세요.",
      action: { kind: "tel", href: "tel:112", label: "112 전화 걸기" },
    },
    POLICE_DOC,
    {
      id: "documents",
      title: "3영업일 안에 피해구제신청서를 은행에 내세요",
      description:
        "전화로 지급정지를 요청했더라도 서면 신청을 하지 않으면 지급정지가 풀립니다. 신청서 초안을 만들어 드릴게요. 인쇄해서 신분증 사본과 함께 은행에 내시면 됩니다.",
      action: { kind: "internal", href: "/p/recovery/docs", label: "서류 만들기" },
    },
    MSAFER,
    ACCOUNT_INFO,
  ],
  cash: [
    {
      id: "report112",
      title: "지금 바로 112에 신고하세요",
      description:
        "현금을 직접 건넨 경우에도 피해 구제를 받을 수 있습니다. 다만 계좌 지급정지는 경찰이 사기범 계좌를 확인해 진행하므로, 신고와 수사 협조가 가장 중요합니다.",
      action: { kind: "tel", href: "tel:112", label: "112 전화 걸기" },
    },
    POLICE_DOC,
    {
      id: "documents",
      title: "피해 경위서를 만들어 두세요",
      description:
        "언제 어떻게 속으셨는지 정리한 경위서가 있으면 경찰 진술과 은행 제출에 그대로 쓸 수 있어요. 문답으로 만들어 드릴게요.",
      action: { kind: "internal", href: "/p/recovery/docs", label: "경위서 만들기" },
    },
    MSAFER,
    ACCOUNT_INFO,
  ],
  giftcard: [
    {
      id: "giftcardStop",
      title: "상품권 발행사에 전화해 사용을 막으세요",
      description:
        "핀 번호를 알려주셨다면 아직 쓰이지 않았을 수 있습니다. 상품권 뒷면이나 구매처의 고객센터로 바로 연락해 사용정지·환불을 요청하세요.",
      action: { kind: "tel", href: "tel:1332", label: "1332에 물어보기" },
    },
    {
      id: "report112",
      title: "112에 신고하세요",
      description:
        "상품권 피해는 계좌 송금이 아니라서 지급정지·환급 절차를 쓸 수 없습니다. 그래도 신고는 반드시 하셔야 수사와 추가 피해 예방이 됩니다.",
      action: { kind: "tel", href: "tel:112", label: "112 전화 걸기" },
    },
    {
      id: "documents",
      title: "피해 경위서를 만들어 두세요",
      description:
        "경찰 진술에 그대로 쓸 수 있도록 언제 어떻게 속으셨는지 정리해 드릴게요.",
      action: { kind: "internal", href: "/p/recovery/docs", label: "경위서 만들기" },
    },
    MSAFER,
    ACCOUNT_INFO,
  ],
};

export const stepsFor = (method: DamageMethod): RecoveryStep[] => CHECKLISTS[method];

export const isStepId = (method: DamageMethod, value: unknown): value is StepId =>
  typeof value === "string" && stepsFor(method).some((step) => step.id === value);

// 아직 하지 않은 첫 단계. 화면 맨 위에 크게 띄운다.
export const nextStep = (
  method: DamageMethod,
  stepsDone: string[],
): RecoveryStep | null =>
  stepsFor(method).find((step) => !stepsDone.includes(step.id)) ?? null;

// --- 데드라인 ---------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// 영업일 = 주말만 건너뛴다. 공휴일은 반영하지 않으므로 화면에서 "은행 영업일 기준"으로
// 안내하고, 촉박하면 하루 앞당겨 움직이도록 말한다.
export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date;
}

// 서면 신청 마감. 법적으로는 "지급정지를 신청한 날"부터 3영업일이지만,
// 피해 당일 신고하는 것이 정상 절차라 피해일을 기준으로 잡는다(보수적으로 더 빠름).
export const writtenDeadline = (incidentAt: Date): Date =>
  addBusinessDays(incidentAt, 3);

export const daysUntil = (target: Date, now: Date): number =>
  Math.ceil((startOfDay(target).getTime() - startOfDay(now).getTime()) / DAY_MS);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const dateLabel = (d: Date): string =>
  d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

export type TimelineItem = {
  label: string;
  dateLabel: string;
  note: string;
  state: "done" | "next" | "future";
};

// 환급까지의 법정 절차 타임라인(F4-3). 계좌이체형만 해당한다 —
// 현금·상품권 피해는 피해자가 직접 밟는 환급 절차가 없다.
export function buildTimeline(
  method: DamageMethod,
  incidentAt: Date,
  stepsDone: string[],
  now: Date,
): TimelineItem[] {
  if (method !== "transfer") return [];

  const deadline = writtenDeadline(incidentAt);
  const noticeEnd = new Date(incidentAt.getTime());
  noticeEnd.setMonth(noticeEnd.getMonth() + 2);
  const refund = new Date(noticeEnd.getTime() + 14 * DAY_MS);
  const applied = stepsDone.includes("documents");
  const left = daysUntil(deadline, now);

  return [
    {
      label: "은행에 서면 신청",
      dateLabel: dateLabel(deadline),
      note: applied
        ? "신청을 마치셨어요."
        : left < 0
          ? "기한이 지났습니다. 은행에 바로 확인해 보세요."
          : `${left === 0 ? "오늘까지" : `${left}일 남았어요`} · 은행 영업일 기준 3일`,
      state: applied ? "done" : "next",
    },
    {
      label: "채권소멸 절차 공고",
      dateLabel: `${dateLabel(noticeEnd)} 무렵`,
      note: "금융감독원이 공고하고 2개월이 지나면 사기범의 계좌 권리가 사라집니다.",
      state: "future",
    },
    {
      label: "피해금 환급 결정",
      dateLabel: `${dateLabel(refund)} 무렵`,
      note: "권리가 사라진 날부터 14일 안에 환급액이 정해집니다.",
      state: "future",
    },
  ];
}

// --- 서류 문답 --------------------------------------------------------------

export type QuestionId = "scamType" | "amount" | "myBank" | "scammerBank" | "story";

export type InterviewQuestion = {
  id: QuestionId;
  prompt: string;
  kind: "choice" | "number" | "text";
  choices?: string[];
  placeholder?: string;
  optional?: boolean;
};

const QUESTIONS: Record<QuestionId, InterviewQuestion> = {
  scamType: {
    id: "scamType",
    prompt: "상대방이 누구라고 하던가요?",
    kind: "choice",
    choices: [
      "검찰·경찰·금융감독원 같은 기관",
      "은행 직원이나 대출 상담원",
      "아들·딸이나 아는 사람",
      "잘 모르겠어요",
    ],
  },
  amount: {
    id: "amount",
    prompt: "얼마를 보내셨나요? 대략이어도 괜찮아요.",
    kind: "number",
    placeholder: "예: 500",
  },
  myBank: {
    id: "myBank",
    prompt: "어느 은행에서 보내셨나요?",
    kind: "text",
    placeholder: "예: 국민은행",
  },
  scammerBank: {
    id: "scammerBank",
    prompt: "받는 쪽 계좌는 어느 은행이었나요? 기억 안 나시면 넘어가셔도 됩니다.",
    kind: "text",
    placeholder: "예: 농협",
    optional: true,
  },
  story: {
    id: "story",
    prompt: "상대방이 뭐라고 하던가요? 기억나는 대로 편하게 적어주세요.",
    kind: "text",
    placeholder: "예: 제 계좌가 범죄에 쓰였다면서 안전계좌로 옮기라고 했어요.",
  },
};

// 계좌이체형만 은행을 묻는다. 현금·상품권 피해는 물어봐야 서류에 쓸 곳이 없다.
export const questionsFor = (method: DamageMethod): InterviewQuestion[] =>
  method === "transfer"
    ? [QUESTIONS.scamType, QUESTIONS.amount, QUESTIONS.myBank, QUESTIONS.scammerBank, QUESTIONS.story]
    : [QUESTIONS.scamType, QUESTIONS.amount, QUESTIONS.story];

export type InterviewAnswers = {
  scamType?: string;
  amount?: string;
  myBank?: string;
  scammerBank?: string;
  story?: string;
  // 사무장이 되물은 추가 질문과 답변. 서류에 필요한 사실이 빠졌을 때만 생긴다.
  followups?: { question: string; answer: string }[];
};

// 생성 결과. 별지 제1호서식의 "피해구제 신청사유"란과 첨부용 경위서에 각각 들어간다.
export type RecoveryDocuments = {
  applicationReason: string;
  narrative: string;
};

// --- 사무장 어시스턴트가 참고하는 절차 지식 ---------------------------------

export const PROCEDURE_KNOWLEDGE = `[신고와 지급정지]
- 112: 전기통신금융사기 통합신고대응센터(2023년 개소)로 일원화되어, 신고 접수와 계좌 지급정지가 한 번에 처리된다. 24시간 가능.
- 돈을 보낸 은행 고객센터에 직접 전화해 지급정지를 요청하는 것도 함께 권한다(가장 빠른 방법).
- 금융감독원 1332: 절차 상담. 비긴급 상담·제보는 1394(구 1566-1188).
- 지급정지는 사기범 계좌에 돈이 남아 있어야 의미가 있다. 그래서 분 단위로 빠를수록 좋다.

[서면 피해구제신청 — 가장 놓치기 쉬운 기한]
- 근거: 통신사기피해환급법 제3조, 시행령 제3조.
- 전화(구술)로 지급정지를 신청했더라도, 신청일부터 3영업일 안에 '피해구제신청서'(시행령 별지 제1호서식)와 신분증 사본을 지급정지를 요청한 금융회사 영업점에 제출해야 한다.
- 내지 않으면 금융회사가 14일 기간을 정해 보완 통지를 하고, 그때도 내지 않으면 신청이 없었던 것으로 보아 지급정지가 풀린다.
- 실무상 경찰서에서 발급받는 '사건사고사실확인원'을 함께 낸다.
- 거짓으로 신청하면 법 제16조에 따라 3년 이하 징역 또는 3천만원 이하 벌금.

[환급까지의 절차]
- 금융회사 → 금융감독원 채권소멸절차 개시 공고 → 공고 후 2개월이 지나면 사기범의 채권이 소멸(법 제9조) → 소멸일부터 14일 안에 금융감독원이 환급금 결정(법 제10조) → 금융회사가 지급.
- 순조로우면 약 2~3개월 걸린다. 계좌 명의인이 이의를 제기하거나 돈이 이미 인출됐으면 더 걸리거나 환급이 어려울 수 있다. 남은 잔액이 피해액보다 적으면 피해자들끼리 피해액 비율대로 나눈다.

[2차 피해 막기]
- 엠세이퍼(msafer.or.kr): 내 명의로 개통된 휴대폰 조회 + 신규 가입 제한. 무료.
- 금융감독원 개인정보노출자 사고예방시스템(pd.fss.or.kr): 노출 사실을 전 금융회사에 공유해 명의도용 계좌개설·카드발급을 막는다.
- 어카운트인포(payinfo.or.kr): 내 계좌 한눈에 보기 + 일괄 지급정지.
- 여신거래 안심차단: 내 이름으로 새 대출·카드론이 나가지 않게 막는 제도. 은행 영업점 방문 신청이 원칙이다.
- 악성 앱을 설치했다면 휴대폰을 초기화하고 비밀번호·인증서를 모두 새로 발급받아야 한다.

[피해 유형별 차이]
- 계좌이체형: 위 절차가 그대로 적용된다.
- 대면편취형(현금을 직접 건넨 경우): 2023년 11월 시행 개정으로 환급 대상에 포함됐지만, 지급정지는 피해자가 아니라 수사기관이 사기범 계좌를 확인해 요청한다. 피해자는 112 신고와 수사 협조가 핵심이다.
- 상품권형(핀 번호를 불러준 경우): 계좌 송금이 아니라서 지급정지·환급 절차를 쓸 수 없다. 발행사 고객센터에 사용정지를 요청하고 경찰에 신고하는 것이 최선이다. 이 점은 솔직하게 알려야 한다.`;
