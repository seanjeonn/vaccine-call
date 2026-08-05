// 심사위원 체험용 데모 데이터. 여러 번 돌려도 같은 결과가 되도록 만들었다.
//   node --env-file=.env prisma/seed.mjs
//
// lib/auth.ts(TS)를 불러올 수 없어 해싱을 여기에 옮겨 적었다. 형식이 바뀌면 같이 고쳐야 한다.

import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const scryptAsync = promisify(scrypt);
const prisma = new PrismaClient();

export const DEMO_EMAIL = "demo-child@vaccinecall.demo";
const DEMO_PASSWORD = "demo1234";

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}

const RISKY_MESSAGES = [
  {
    role: "assistant",
    content:
      "서울중앙지방검찰청 김민수 수사관입니다. 본인 명의 계좌가 대포통장 사건에 연루되어 확인차 연락드렸습니다.",
  },
  { role: "user", content: "네? 제가요? 저는 그런 적이 없는데요." },
  { role: "assistant", content: "본인 확인이 필요합니다. 주민등록번호 뒷자리를 불러주세요." },
  { role: "user", content: "아 네, 1234567입니다. 제가 뭘 잘못했나요?" },
  {
    role: "assistant",
    content: "자산 보호를 위해 안전계좌로 이체가 필요합니다. 지금 은행에 가실 수 있습니까?",
  },
  { role: "user", content: "네 지금 바로 은행 가서 보내드릴게요." },
];

const RISKY_REPORT = {
  overallRisk: "high",
  riskMoments: [
    {
      turnIndex: 3,
      tags: ["personal_info"],
      severity: "high",
      quote: "아 네, 1234567입니다.",
      explanation: "주민등록번호 뒷자리를 상대에게 알려주었습니다.",
    },
    {
      turnIndex: 5,
      tags: ["money_compliance", "instruction_compliance"],
      severity: "high",
      quote: "네 지금 바로 은행 가서 보내드릴게요.",
      explanation: "사기범의 송금 요구에 그대로 응하겠다고 했습니다.",
    },
  ],
  diagnosis: {
    vulnerabilityType: "권위에 약한 유형",
    summary:
      "상대가 검찰을 사칭하자 의심 없이 믿고 개인정보와 송금 요구에 모두 응했습니다.",
  },
  tips: [
    "검찰·경찰은 전화로 주민등록번호나 계좌를 묻지 않습니다.",
    "이런 전화를 받으면 일단 끊고, 직접 기관 대표번호로 다시 걸어 확인하세요.",
    "돈을 보내라는 말이 나오면 반드시 자녀에게 먼저 알리세요.",
  ],
};

const LOAN_MESSAGES = [
  {
    role: "assistant",
    content:
      "고객님, 저금리 대출 전환 대상자로 선정되셨습니다. 기존 대출을 먼저 상환하셔야 승인이 납니다.",
  },
  { role: "user", content: "이자가 얼마나 낮아지는데요?" },
  { role: "assistant", content: "심사를 위해 통장 계좌번호를 알려주시겠어요?" },
  { role: "user", content: "계좌번호는 123-456-7890이에요." },
  { role: "assistant", content: "그럼 상환금 500만원을 지금 보내주시면 됩니다." },
  { role: "user", content: "돈 보내는 건 좀 아닌 것 같은데요. 자식한테 물어보고 다시 연락할게요." },
];

const LOAN_REPORT = {
  overallRisk: "medium",
  riskMoments: [
    {
      turnIndex: 3,
      tags: ["personal_info"],
      severity: "medium",
      quote: "계좌번호는 123-456-7890이에요.",
      explanation: "심사를 핑계로 요구한 계좌번호를 그대로 알려주었습니다.",
    },
  ],
  diagnosis: {
    vulnerabilityType: "개인정보를 쉽게 내주는 유형",
    summary:
      "송금 요구는 거절하셨지만, 계좌번호는 의심 없이 알려주셨습니다. 지난 훈련에 이어 개인정보 노출이 반복되고 있습니다.",
  },
  tips: [
    "대출 심사에 계좌번호가 먼저 필요한 경우는 없습니다.",
    "기존 대출을 먼저 갚아야 한다는 말은 대출 사기의 대표 수법입니다.",
    "돈을 거절한 것처럼, 개인정보도 똑같이 거절하셔도 됩니다.",
  ],
};

const SAFE_MESSAGES = [
  {
    role: "assistant",
    content: "엄마, 나야. 사고가 나서 합의금이 급하게 필요한데 폰이 고장 나서 다른 번호로 걸었어.",
  },
  { role: "user", content: "목소리가 좀 다른데요. 우리 아들 맞아요?" },
  { role: "assistant", content: "감기 걸려서 그래. 지금 급하니까 300만원만 빨리 보내줘." },
  {
    role: "user",
    content: "아니요, 제가 아들한테 직접 전화해서 확인해 볼게요. 끊겠습니다.",
  },
];

const SAFE_REPORT = {
  overallRisk: "low",
  riskMoments: [],
  diagnosis: {
    vulnerabilityType: "확인 습관이 자리 잡은 유형",
    summary:
      "목소리가 다르다는 점을 놓치지 않고, 직접 전화해 확인하겠다며 통화를 끊으셨습니다. 가족 사칭에 가장 좋은 대응입니다.",
  },
  tips: [
    "가족이 돈을 요구하면 반드시 원래 번호로 직접 걸어 확인하세요.",
    "목소리는 흉내낼 수 있습니다. 가족만 아는 질문을 미리 정해두면 좋습니다.",
    "급하다고 재촉할수록 더 의심하세요.",
  ],
};

// 피해구제 데모 사건(F4). 심사위원이 체크리스트 중간 상태와 완성된 서류를 바로 볼 수 있게
// 어제 발생한 계좌이체 피해로 넣는다. 서류 초안은 실제 생성 결과를 옮겨 적은 고정 문안이다.
const RECOVERY_ANSWERS = {
  scamType: "검찰·경찰·금융감독원 같은 기관",
  amount: "500",
  myBank: "국민은행",
  scammerBank: "농협",
  story:
    "서울중앙지검 수사관이라면서 제 계좌가 대포통장 사건에 쓰였다고 했어요. 자산을 지켜야 한다면서 안전계좌로 옮기라고 해서 시키는 대로 보냈습니다.",
};

const RECOVERY_DOCUMENTS = {
  applicationReason:
    "본인은 서울중앙지방검찰청 수사관을 사칭한 성명불상자로부터 전화를 받았습니다. 상대방은 본인 명의의 계좌가 대포통장 범죄에 연루되었다고 하며, 자산 보호를 위해 이른바 안전계좌로 자금을 이체해야 한다고 말하였습니다. 본인은 이를 사실로 믿고 국민은행 계좌에서 농협 계좌로 5,000,000원을 이체하였습니다. 이후 가족에게 이야기하면서 전기통신금융사기임을 알게 되었고, 112에 신고하여 지급정지를 요청하였습니다. 위와 같이 전기통신금융사기 피해를 입었으므로 피해구제를 신청합니다.",
  narrative:
    "본인은 어제 오전 모르는 번호로 전화를 받았습니다. 상대방은 자신을 서울중앙지방검찰청 수사관이라고 소개하며, 본인 명의의 계좌가 대포통장 사건에 연루되어 조사가 필요하다고 하였습니다.\n\n상대방은 사건번호와 담당 검사의 이름을 말하며 본인을 압박하였고, 이 사실을 가족을 포함한 누구에게도 알리지 말라고 하였습니다. 또한 계좌에 있는 자금이 범죄수익으로 몰수될 수 있으니 국가가 관리하는 안전계좌로 옮겨야 한다고 하였습니다. 본인은 검찰이라는 말에 놀라 상대방의 말을 그대로 믿었습니다.\n\n본인은 상대방이 알려준 농협 계좌로 국민은행 계좌에서 5,000,000원을 이체하였습니다. 이체 직후에도 상대방은 추가 확인이 필요하다며 통화를 계속 이어가려 하였습니다.\n\n통화를 마친 뒤 자녀에게 이 사실을 이야기하던 중 전기통신금융사기임을 알게 되었습니다. 본인은 즉시 112에 신고하여 지급정지를 요청하였고, 송금한 국민은행 고객센터에도 같은 내용을 알렸습니다. 이후 경찰서를 방문하여 정식으로 신고할 예정입니다.",
};

async function main() {
  const child = await prisma.child.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD) },
  });

  // 부모는 email 같은 고유키가 없어 이름으로 찾아 재사용한다.
  // 프로필(F1-1)은 심사위원이 데모로 들어오자마자 맞춤 시나리오가 걸리도록 매번 채운다.
  const profile = { name: "어머니", ageGroup: "70대", bank: "KB국민은행", family: "아들" };
  const found = await prisma.parent.findFirst({
    where: { childId: child.id, name: profile.name },
  });
  const parent = found
    ? await prisma.parent.update({ where: { id: found.id }, data: profile })
    : await prisma.parent.create({ data: { childId: child.id, ...profile } });

  // 회차 추이(F1-5)를 보여주려면 순서가 분명해야 해서, 매번 지우고 날짜를 지정해 다시 만든다.
  await prisma.notification.deleteMany({ where: { childId: child.id } });
  await prisma.report.deleteMany({ where: { parentId: parent.id } });

  const daysAgo = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 위험 높음 → 주의 → 낮음으로 개선되지만, 개인정보 노출은 1·2회차에 반복된다.
  const risky = await prisma.report.create({
    data: {
      parentId: parent.id,
      scenarioId: "institution",
      report: RISKY_REPORT,
      messages: RISKY_MESSAGES,
      createdAt: daysAgo(7),
    },
  });
  await prisma.report.create({
    data: {
      parentId: parent.id,
      scenarioId: "loan",
      report: LOAN_REPORT,
      messages: LOAN_MESSAGES,
      createdAt: daysAgo(3),
    },
  });
  const safe = await prisma.report.create({
    data: {
      parentId: parent.id,
      scenarioId: "family",
      report: SAFE_REPORT,
      messages: SAFE_MESSAGES,
      createdAt: daysAgo(1),
    },
  });

  // 어제 피해가 난 상태. 2단계까지 마쳤고 서류 초안은 이미 만들어 두었다.
  const incidentAt = daysAgo(1);
  await prisma.recoveryCase.upsert({
    where: { parentId: parent.id },
    update: {
      method: "transfer",
      incidentAt,
      stepsDone: ["report112", "policeDoc"],
      answers: RECOVERY_ANSWERS,
      documents: RECOVERY_DOCUMENTS,
    },
    create: {
      parentId: parent.id,
      method: "transfer",
      incidentAt,
      stepsDone: ["report112", "policeDoc"],
      answers: RECOVERY_ANSWERS,
      documents: RECOVERY_DOCUMENTS,
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        childId: child.id,
        type: "risk",
        title: "어머니님이 보이스피싱 피해 구제를 시작했어요",
        body: "골든타임 절차를 진행 중입니다. 지금 바로 전화해 확인해 주세요.",
        createdAt: incidentAt,
      },
      {
        childId: child.id,
        reportId: safe.id,
        type: "report",
        title: "어머니님이 훈련을 마쳤어요",
        body: SAFE_REPORT.diagnosis.summary,
        createdAt: daysAgo(1),
      },
      {
        childId: child.id,
        reportId: risky.id,
        type: "risk",
        title: "어머니님의 훈련에서 위험 신호가 있었어요",
        body: RISKY_REPORT.diagnosis.summary,
        createdAt: daysAgo(7),
      },
    ],
  });

  console.log(`데모 계정 준비 완료: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  부모: ${parent.name} (${parent.ageGroup} · ${parent.bank} · ${parent.family})`);
  console.log(`  리포트: ${await prisma.report.count({ where: { parentId: parent.id } })}건`);
  console.log("  피해구제: 계좌이체 피해 1건 (2/5단계 완료, 서류 초안 있음)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
