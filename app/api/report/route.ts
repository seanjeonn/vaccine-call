import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { resolveScenario } from "@/lib/scenarios";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  RISK_TAG_CRITERIA,
  RISK_TAG_IDS,
  RISK_TAG_LABELS,
  type RiskMoment,
  type TrainingReport,
} from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o";

type ChatMessage = { role: "user" | "assistant"; content: string };

// 구조화 출력 스키마. strict 모드라 모든 필드가 required이고 추가 속성을 허용하지 않는다.
const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallRisk", "riskMoments", "diagnosis", "tips"],
  properties: {
    overallRisk: { type: "string", enum: ["low", "medium", "high"] },
    riskMoments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["turnIndex", "tags", "severity", "quote", "explanation"],
        properties: {
          turnIndex: { type: "integer" },
          tags: {
            type: "array",
            items: { type: "string", enum: RISK_TAG_IDS },
          },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          quote: { type: "string" },
          explanation: { type: "string" },
        },
      },
    },
    diagnosis: {
      type: "object",
      additionalProperties: false,
      required: ["vulnerabilityType", "summary"],
      properties: {
        vulnerabilityType: { type: "string" },
        summary: { type: "string" },
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
} as const;

function buildSystemPrompt(input: unknown) {
  const scenario = resolveScenario(input);
  const tagLines = RISK_TAG_IDS.map(
    (id) => `- ${id} (${RISK_TAG_LABELS[id]}): ${RISK_TAG_CRITERIA[id]}`,
  ).join("\n");

  return `당신은 보이스피싱 예방 훈련의 분석 전문가입니다. 방금 끝난 모의 훈련 통화의 녹취록을 분석해 훈련자에게 돌려줄 리포트를 작성합니다.

이번 훈련 시나리오: ${scenario.label}
사기범의 접근 방식: ${scenario.opening}

분석 규칙:
- "나"(훈련자)의 발화만 평가합니다. "사기꾼"의 발화는 맥락 파악에만 사용하세요.
- turnIndex는 각 발화 앞의 대괄호 번호를 그대로 사용하세요.
- 실제로 위험했던 발화만 riskMoments에 넣으세요. 억지로 찾아내지 마세요.
- 위험한 발화가 하나도 없으면 riskMoments는 빈 배열, overallRisk는 low로 두고, diagnosis는 잘 대응한 점을 칭찬하는 내용으로 작성하세요.
- quote는 해당 발화에서 그대로 발췌하세요.

위험 태그 (반드시 아래 값 중에서만 선택):
${tagLines}

작성 어조:
- 고령 훈련자가 읽습니다. 쉬운 말과 존댓말을 쓰고, 겁주기보다 다음에 어떻게 하면 되는지 알려주세요.
- explanation은 1~2문장으로 짧게.
- diagnosis.vulnerabilityType은 "권위에 약한 유형"처럼 짧은 명사구로.
- tips는 이번 시나리오 수법에 맞춘 구체적인 예방 수칙 3개, 각 한 문장.`;
}

// 부모 세션이면 리포트를 남기고 자녀에게 알린다. 체험 모드(세션 없음)면 아무것도 하지 않는다.
// 저장이 실패해도 리포트 자체는 돌려줘야 하므로 여기서 오류를 삼킨다.
async function persist(
  report: TrainingReport,
  messages: ChatMessage[],
  scenario: unknown,
): Promise<string | undefined> {
  try {
    const session = await getSession();
    if (session?.role !== "parent" || !session.parentId) return undefined;

    const parent = await prisma.parent.findUnique({ where: { id: session.parentId } });
    if (!parent) return undefined;

    const saved = await prisma.report.create({
      data: {
        parentId: parent.id,
        scenarioId: resolveScenario(scenario).id,
        report: report as unknown as Prisma.InputJsonValue,
        messages: messages as unknown as Prisma.InputJsonValue,
      },
    });

    const risky = report.overallRisk === "high";
    await prisma.notification.create({
      data: {
        childId: parent.childId,
        reportId: saved.id,
        type: risky ? "risk" : "report",
        title: risky
          ? `${parent.name}님의 훈련에서 위험 신호가 있었어요`
          : `${parent.name}님이 훈련을 마쳤어요`,
        body: report.diagnosis.summary,
      },
    });

    return saved.id;
  } catch (err) {
    console.error("[report] persist failed", err);
    return undefined;
  }
}

// 녹취록을 인덱스가 붙은 형태로 만든다. LLM이 turnIndex를 정확히 지목하게 하려는 목적.
function formatTranscript(messages: ChatMessage[]) {
  return messages
    .map(
      (m, i) => `[${i}] ${m.role === "user" ? "나" : "사기꾼"}: ${m.content}`,
    )
    .join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { messages, scenario } = (await req.json()) as {
      messages: ChatMessage[];
      scenario?: unknown;
    };

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages 배열이 필요합니다." },
        { status: 400 },
      );
    }

    if (!messages.some((m) => m.role === "user")) {
      return NextResponse.json(
        { error: "분석할 사용자 발화가 없습니다." },
        { status: 400 },
      );
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 1200,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "training_report",
          strict: true,
          schema: REPORT_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: buildSystemPrompt(scenario) },
        { role: "user", content: formatTranscript(messages) },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json(
        { error: "분석 결과가 비어 있습니다." },
        { status: 502 },
      );
    }

    const parsed = JSON.parse(raw) as TrainingReport;

    // LLM이 존재하지 않는 턴이나 사기꾼 발화를 지목한 경우를 걸러낸다.
    const riskMoments = parsed.riskMoments.filter(
      (m: RiskMoment) =>
        Number.isInteger(m.turnIndex) &&
        messages[m.turnIndex]?.role === "user",
    );

    const report = { ...parsed, riskMoments };
    const reportId = await persist(report, messages, scenario);

    return NextResponse.json({ report, reportId });
  } catch (err) {
    console.error("[report] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `리포트 생성 실패: ${detail}` },
      { status: 500 },
    );
  }
}
