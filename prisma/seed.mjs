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

async function main() {
  const child = await prisma.child.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash: await hashPassword(DEMO_PASSWORD) },
  });

  // 부모는 email 같은 고유키가 없어 이름으로 찾아 재사용한다.
  let parent = await prisma.parent.findFirst({
    where: { childId: child.id, name: "어머니" },
  });
  if (!parent) {
    parent = await prisma.parent.create({
      data: { childId: child.id, name: "어머니", ageGroup: "70대" },
    });
  }

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

  await prisma.notification.createMany({
    data: [
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
  console.log(`  부모: ${parent.name} (${parent.ageGroup})`);
  console.log(`  리포트: ${await prisma.report.count({ where: { parentId: parent.id } })}건`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
