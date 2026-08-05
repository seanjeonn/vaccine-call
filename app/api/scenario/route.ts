// 프로필 기반 맞춤 시나리오 생성(F1-1). 통화 시작마다 한 번 호출된다.
// 유형은 코드가 고르고 LLM은 가변 부분(발신자·오프닝·맞춤 지침)만 만든다.
// 다듬어 온 롤플레이 골격(lib/scenarios.ts)을 매 통화 새로 쓰지 않기 위해서다.

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  SCENARIOS,
  getScenario,
  randomScenario,
  type Scenario,
  type ScenarioId,
} from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini";

type Profile = {
  name: string;
  ageGroup: string;
  bank: string | null;
  family: string | null;
};

const CUSTOM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["callerName", "opening", "personalization"],
  properties: {
    callerName: { type: "string" },
    opening: { type: "string" },
    personalization: { type: "string" },
  },
} as const;

// 사칭할 가족이 없다면 가족사칭형은 배정하지 않는다.
function pickType(profile: Profile): ScenarioId {
  const candidates = SCENARIOS.filter(
    (s) => s.id !== "family" || (profile.family !== null && profile.family !== "해당 없음"),
  );
  return candidates[Math.floor(Math.random() * candidates.length)].id;
}

function buildPrompt(base: Scenario, profile: Profile) {
  const facts = [
    `호칭: ${profile.name}`,
    `연령대: ${profile.ageGroup}`,
    profile.bank ? `주거래 은행: ${profile.bank}` : null,
    profile.family && profile.family !== "해당 없음"
      ? `가족: ${profile.family}이(가) 있음`
      : "가족: 사칭할 자녀 없음",
  ]
    .filter(Boolean)
    .join("\n");

  return `당신은 보이스피싱 예방 훈련용 모의 시나리오를 각 훈련자에게 맞게 다듬는 작가입니다.

훈련자 프로필:
${facts}

배정된 수법: ${base.label}
이 수법의 기본 발신자 표시: ${base.caller.name}
이 수법의 기본 오프닝: ${base.opening}

배역은 그대로 두고, 프로필을 반영해 아래 세 가지만 새로 씁니다.

- callerName: 폰 화면에 뜰 발신자 표시. **배정된 배역과 반드시 일치해야 합니다.** 기본 발신자 표시를 프로필에 맞게 다듬는 정도로만 바꾸세요. 가족을 사칭하는 수법이면 은행·기관 이름을 쓰지 마세요.
- opening: 사기범이 전화를 받자마자 하는 첫 대사 2~3문장. 기관·상담원 배역이면 훈련자를 "고객님"이나 "○○○ 고객님"으로 부르고, 가족 배역이면 "엄마"처럼 자연스럽게 부르세요. 프로필 요소를 한 가지 이상 녹이세요.
- personalization: 사기범 롤플레이 지침에 덧붙일 3~4줄. 각 줄은 "- "로 시작합니다. **배정된 배역을 벗어나는 지시는 쓰지 마세요.** 프로필 중 이 수법에 실제로 쓸모 있는 것만 파고듭니다 — 은행·대출 수법이면 주거래 은행, 가족 사칭이면 가족 관계, 어느 수법이든 연령대에 맞춘 말투.

지켜야 할 것:
- 가족은 "아들"·"딸"처럼 관계로만 부릅니다. 가족의 실명은 수집하지 않으므로 지어내지 마세요.
- 훈련자의 실제 계좌번호·주민번호를 아는 척하지 마세요. 사기범이 요구하게 만드는 것이 목적입니다.
- 모두 한국어로, 실제 전화처럼 자연스럽게 씁니다.`;
}

export async function POST() {
  try {
    const session = await getSession();
    const parent =
      session?.role === "parent" && session.parentId
        ? await prisma.parent.findUnique({
            where: { id: session.parentId },
            select: { name: true, ageGroup: true, bank: true, family: true },
          })
        : null;

    // 프로필이 없으면 예전처럼 랜덤 정적 시나리오로 훈련한다.
    if (!parent || (parent.bank === null && parent.family === null)) {
      return NextResponse.json(randomScenario());
    }

    const base = getScenario(pickType(parent));
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.8, // 회차마다 다른 이야기가 나오도록
      response_format: {
        type: "json_schema",
        json_schema: { name: "custom_scenario", strict: true, schema: CUSTOM_SCHEMA },
      },
      messages: [{ role: "user", content: buildPrompt(base, parent) }],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("생성 결과가 비어 있습니다.");
    const custom = JSON.parse(raw) as {
      callerName: string;
      opening: string;
      personalization: string;
    };

    const scenario: Scenario = {
      ...base,
      // 번호는 프로필에서 나올 값이 아니라 LLM에 맡기지 않는다. 예시용 번호가 뜨는 것을 막는다.
      caller: { name: custom.callerName, number: base.caller.number },
      opening: custom.opening,
      systemPrompt: `${base.systemPrompt}\n\n맞춤 설정:\n${custom.personalization}`,
    };

    return NextResponse.json(scenario);
  } catch (err) {
    // 통화 시작이 에러로 죽으면 안 된다. 무슨 일이 있어도 훈련은 시작되게 한다.
    console.error("[scenario] error", err);
    return NextResponse.json(randomScenario());
  }
}
