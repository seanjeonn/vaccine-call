// 훈련 중 개입 판정(F1-4). 사용자 발화 한 턴이 "결정적으로 속은 순간"인지만 본다.
// 사후 리포트(/api/report)와 태그 정의는 공유하되, 여기서는 개입 여부만 빠르게 답한다.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveScenario } from "@/lib/scenarios";
import { RISK_TAG_CRITERIA, RISK_TAG_LABELS, type RiskTagId } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini";

// 개입시키는 태그는 2종뿐. 심리적 동요·지시 이행은 오탐이 잦아 리포트에만 남긴다.
const INTERVENE_TAGS: RiskTagId[] = ["personal_info", "money_compliance"];

export type GuardVerdict = {
  intervene: boolean;
  tag: RiskTagId;
  quote: string;
  consequence: string;
};

// strict 모드라 모든 필드가 required다. nullable을 피하려고 intervene만 결정 비트로 쓰고
// 나머지는 개입하지 않을 때 빈 값을 채우게 한다.
const GUARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intervene", "tag", "quote", "consequence"],
  properties: {
    intervene: { type: "boolean" },
    tag: { type: "string", enum: INTERVENE_TAGS },
    quote: { type: "string" },
    consequence: { type: "string" },
  },
} as const;

function buildSystemPrompt(input: unknown) {
  const scenario = resolveScenario(input);
  const tagLines = INTERVENE_TAGS.map(
    (id) => `- ${id} (${RISK_TAG_LABELS[id]}): ${RISK_TAG_CRITERIA[id]}`,
  ).join("\n");

  return `당신은 보이스피싱 예방 훈련을 지켜보는 감시자입니다. 훈련자가 결정적으로 속아 넘어간 순간에만 훈련을 중단시킵니다.

이번 훈련 시나리오: ${scenario.label}

판정 대상:
- 직전 사기범 대사는 맥락 파악용입니다. 판정은 훈련자의 마지막 발화 하나만 보고 합니다.

intervene을 true로 하는 경우 (아래 둘 중 하나에 실제로 해당할 때만):
${tagLines}
- personal_info: 주민등록번호·계좌번호·카드번호·비밀번호·OTP 같은 값을 실제로 말한 경우 (숫자든 우리말로 읽었든).
- money_compliance: 송금·이체·현금 인출·상품권 구매·계좌 이동에 분명히 동의했거나 지금 하겠다고 말한 경우.

intervene을 false로 하는 경우 (중요):
- 의심하거나 거절한 경우 ("그런 전화는 못 믿겠는데요", "돈은 못 보내드립니다")
- 확인하려는 경우 ("아들한테 직접 전화해 볼게요", "은행에 가서 확인해 볼게요")
- 되묻거나 질문하는 경우 ("주민등록번호를 왜 물어보세요?")
- 단순 호응이나 인사 ("네", "여보세요", "무슨 일이신데요")
- 겁먹거나 당황하기만 한 경우
- 이름·나이처럼 민감하지 않은 정보만 말한 경우
- 애매하면 false로 하세요. 정상 대화를 끊는 오탐이 놓치는 것보다 훨씬 나쁩니다.

출력 규칙:
- quote: 훈련자 발화에서 그대로 짧게 발췌합니다.
- consequence: "실제였다면"으로 시작해 어떤 일이 벌어졌을지 한 문장. 고령 훈련자가 읽으니 쉬운 존댓말로, 겁주기보다 사실을 알려주세요. "당신"·"귀하" 같은 호칭은 쓰지 말고 무슨 일이 벌어지는지만 쓰세요.
- intervene이 false면 tag는 personal_info로 두고 quote와 consequence는 빈 문자열로 두세요.`;
}

export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { text, lastAssistant, scenario } = (await req.json()) as {
      text?: string;
      lastAssistant?: string;
      scenario?: unknown;
    };

    if (typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "text가 필요합니다." }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 200,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "intervention_verdict",
          strict: true,
          schema: GUARD_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(scenario) },
        {
          role: "user",
          content: `사기꾼: ${lastAssistant?.trim() || "(없음)"}\n훈련자: ${text.trim()}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ error: "판정 결과가 비어 있습니다." }, { status: 502 });
    }

    return NextResponse.json(JSON.parse(raw) as GuardVerdict);
  } catch (err) {
    console.error("[guard] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `개입 판정 실패: ${detail}` }, { status: 500 });
  }
}
