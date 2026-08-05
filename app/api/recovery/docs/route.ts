import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  METHOD_LABELS,
  questionsFor,
  stepsFor,
  type DamageMethod,
  type InterviewAnswers,
  type RecoveryDocuments,
} from "@/lib/recovery";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o";

// 되물을지 바로 쓸지를 한 번의 호출로 정한다. followups가 비면 서류가 완성된 것이다.
const DOCS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["followups", "applicationReason", "narrative"],
  properties: {
    followups: {
      type: "array",
      items: { type: "string" },
    },
    applicationReason: { type: "string" },
    narrative: { type: "string" },
  },
} as const;

const SYSTEM = `당신은 보이스피싱 피해자의 서류 작성을 돕는 사무장입니다. 어르신의 문답을 바탕으로 두 가지 글을 작성합니다.

1. applicationReason — 「전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법 시행령」 별지 제1호서식 '피해구제 신청사유'란에 그대로 들어갈 글입니다.
   - 육하원칙을 담은 3~5문장. 격식체("~하였습니다").
   - "…라고 속아 …원을 이체하는 전기통신금융사기 피해를 입었으므로 피해구제를 신청합니다"로 맺으세요.

2. narrative — 첨부하는 '피해 경위서'입니다.
   - 시간 순서대로: 최초 접촉(언제 어떤 전화를 받았는지) → 속게 된 과정(상대가 한 말) → 송금 → 피해를 알게 된 시점 → 그 뒤 취한 조치.
   - 격식체 400~700자. 문단을 나누되 제목이나 번호는 붙이지 마세요.
   - 마지막 문단에 이미 마친 조치(신고·지급정지 요청 등)를 사실대로 적으세요.

절대 지켜야 할 규칙:
- 성명·주민등록번호·생년월일·주소·연락처·계좌번호는 절대 만들어 쓰지 마세요. 서식의 빈칸에 본인이 손으로 적습니다. 필요하면 "본인"이라고만 쓰세요.
- 문답에 없는 사실을 지어내지 마세요. 날짜·금액·은행명은 주어진 값만 씁니다.
- 사기범을 특정하는 추측(이름, 소속 확정)을 쓰지 마세요. "검찰을 사칭한 성명불상자"처럼 적으세요.

되묻기(followups):
- 위 두 글을 사실대로 쓰기에 정보가 모자라면, 어르신께 여쭐 짧은 질문을 최대 2개까지 followups에 담고 나머지 두 필드는 빈 문자열로 두세요.
- 질문은 고령자가 바로 답할 수 있게 한 문장으로, 쉬운 말로 쓰세요. 계좌번호·주민등록번호 같은 민감정보는 묻지 마세요.
- 이미 되물어 답을 받았다면 더 묻지 말고 있는 사실로 작성하세요.
- 어느 정도 쓸 수 있으면 되묻지 말고 작성하세요. 사소한 것까지 캐묻지 마세요.`;

function formatAnswers(
  method: DamageMethod,
  incidentAt: Date,
  answers: InterviewAnswers,
  stepsDone: string[],
): string {
  const questions = questionsFor(method);
  const lines = [
    `피해 유형: ${METHOD_LABELS[method]}`,
    `피해 발생일: ${incidentAt.toLocaleDateString("ko-KR")}`,
    ...questions.map((question) => {
      const value = answers[question.id];
      const shown = question.id === "amount" && value ? `${value}만원` : value;
      return `${question.prompt} → ${shown?.trim() || "(답하지 않음)"}`;
    }),
    ...(answers.followups ?? []).map((f) => `${f.question} → ${f.answer.trim() || "(답하지 않음)"}`),
  ];

  const done = stepsFor(method)
    .filter((step) => stepsDone.includes(step.id))
    .map((step) => step.title);
  lines.push(`이미 마친 조치: ${done.join(" / ") || "아직 없음"}`);

  return lines.join("\n");
}

// 문답을 서류 초안으로 바꾼다. 정보가 모자라면 서류 대신 되물을 질문을 돌려준다(F4-2).
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session?.role !== "parent" || !session.parentId) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { parentId: session.parentId },
      include: { parent: { select: { name: true, childId: true } } },
    });
    if (!recoveryCase) {
      return NextResponse.json({ error: "진행 중인 사건이 없습니다." }, { status: 404 });
    }

    const { answers } = (await req.json()) as { answers?: InterviewAnswers };
    if (!answers || typeof answers !== "object") {
      return NextResponse.json({ error: "문답 내용이 필요합니다." }, { status: 400 });
    }

    const method = recoveryCase.method as DamageMethod;
    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 1200,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: { name: "recovery_documents", strict: true, schema: DOCS_SCHEMA },
      },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: formatAnswers(
            method,
            recoveryCase.incidentAt,
            answers,
            (recoveryCase.stepsDone as string[]) ?? [],
          ),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ error: "서류를 만들지 못했습니다." }, { status: 502 });
    }

    const parsed = JSON.parse(raw) as RecoveryDocuments & { followups: string[] };
    const followups = (parsed.followups ?? []).filter((q) => q.trim()).slice(0, 2);

    // 한 번 되물은 뒤에도 또 묻지 않는다. 어르신을 계속 붙잡아 두지 않으려는 제한이다.
    const alreadyAsked = (answers.followups ?? []).length > 0;
    if (followups.length > 0 && !alreadyAsked) {
      await prisma.recoveryCase.update({
        where: { parentId: session.parentId },
        data: { answers: answers as unknown as Prisma.InputJsonValue },
      });
      return NextResponse.json({ followups });
    }

    const documents: RecoveryDocuments = {
      applicationReason: parsed.applicationReason.trim(),
      narrative: parsed.narrative.trim(),
    };
    if (!documents.applicationReason || !documents.narrative) {
      return NextResponse.json({ error: "서류 내용이 비어 있습니다." }, { status: 502 });
    }

    await prisma.recoveryCase.update({
      where: { parentId: session.parentId },
      data: {
        answers: answers as unknown as Prisma.InputJsonValue,
        documents: documents as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.notification.create({
      data: {
        childId: recoveryCase.parent.childId,
        type: "recovery",
        title: `${recoveryCase.parent.name}님의 피해구제 서류 초안이 준비됐어요`,
        body:
          method === "transfer"
            ? "인쇄해서 신분증 사본과 함께 은행에 제출해야 합니다. 3영업일 기한을 꼭 확인해 주세요."
            : "경찰 진술과 은행 제출에 쓸 피해 경위서를 만들었습니다.",
      },
    });

    return NextResponse.json({ documents });
  } catch (err) {
    console.error("[recovery/docs] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `서류 생성 실패: ${detail}` }, { status: 500 });
  }
}
