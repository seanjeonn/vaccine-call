import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  METHOD_LABELS,
  PROCEDURE_KNOWLEDGE,
  buildTimeline,
  nextStep,
  stepsFor,
  type DamageMethod,
  type InterviewAnswers,
} from "@/lib/recovery";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o";

type ChatMessage = { role: "user" | "assistant"; content: string };

const PERSONA = `당신은 보이스피싱 피해자를 돕는 "AI 사무장"입니다. 피해를 막 당한 고령의 어르신과 이야기하고 있습니다.

말하는 법:
- 존댓말로, 짧고 쉬운 문장을 쓰세요. 한 번에 3문장을 넘기지 마세요.
- 법률 용어를 쓸 때는 곧바로 쉬운 말로 풀어주세요.
- 어르신은 겁먹고 자책하고 있습니다. 먼저 안심시키고, 지금 하실 일 하나만 짚어주세요.
- 전화번호나 서류 이름은 정확히 말해주세요.
- 목록이 필요하면 짧게, 마크다운 기호(*, #) 없이 줄바꿈으로 쓰세요. 음성으로도 읽어드리기 때문입니다.

지켜야 할 것:
- 아래 [절차 지식]에 없는 내용은 지어내지 마세요. 모르면 "그건 112나 금융감독원 1332에 확인하셔야 합니다"라고 하세요.
- 돈을 돌려받는다고 장담하지 마세요. 남은 잔액이 없으면 어렵다는 사실을 부드럽게 알려주세요.
- 어르신을 탓하지 마세요. 속은 것은 어르신 잘못이 아닙니다.
- 계좌번호·주민등록번호·비밀번호는 절대 묻지 마세요. 어르신이 먼저 말씀하시면 "그건 저에게 알려주지 않으셔도 됩니다"라고 하세요.`;

// 사무장이 현재 사건을 알고 답하도록 상태를 프롬프트에 넣는다.
function buildCaseContext(
  method: DamageMethod,
  incidentAt: Date,
  stepsDone: string[],
  answers: InterviewAnswers | null,
  hasDocuments: boolean,
): string {
  const steps = stepsFor(method);
  const upcoming = nextStep(method, stepsDone);
  const timeline = buildTimeline(method, incidentAt, stepsDone, new Date());
  const deadline = timeline.find((item) => item.state === "next");

  const lines = [
    `피해 유형: ${METHOD_LABELS[method]}`,
    `피해 시점: ${incidentAt.toLocaleDateString("ko-KR")}`,
    `마친 단계: ${
      steps
        .filter((step) => stepsDone.includes(step.id))
        .map((step) => step.title)
        .join(" / ") || "아직 없음"
    }`,
    `지금 하실 일: ${upcoming ? upcoming.title : "모든 단계를 마쳤습니다"}`,
  ];

  if (deadline) lines.push(`서면 신청 기한: ${deadline.dateLabel} (${deadline.note})`);
  if (answers?.scamType) lines.push(`사기범 사칭: ${answers.scamType}`);
  if (answers?.amount) lines.push(`피해 금액: 약 ${answers.amount}만원`);
  if (answers?.story) lines.push(`어르신이 말씀하신 경위: ${answers.story}`);
  lines.push(`서류 초안: ${hasDocuments ? "이미 만들어 두었습니다" : "아직 만들지 않았습니다"}`);

  return lines.join("\n");
}

// 사무장 대화(F4). 문장이 완성되는 대로 화면에 흘리려고 순수 텍스트 청크로 내보낸다.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session?.role !== "parent" || !session.parentId) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { parentId: session.parentId },
    });
    if (!recoveryCase) {
      return NextResponse.json({ error: "진행 중인 사건이 없습니다." }, { status: 404 });
    }

    const { messages } = (await req.json()) as { messages: ChatMessage[] };
    if (!Array.isArray(messages)) {
      return NextResponse.json({ error: "messages 배열이 필요합니다." }, { status: 400 });
    }

    const system = `${PERSONA}

[절차 지식]
${PROCEDURE_KNOWLEDGE}

[지금 이 어르신의 상황]
${buildCaseContext(
  recoveryCase.method as DamageMethod,
  recoveryCase.incidentAt,
  (recoveryCase.stepsDone as string[]) ?? [],
  recoveryCase.answers as InterviewAnswers | null,
  recoveryCase.documents !== null,
)}`;

    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      temperature: 0.4,
      stream: true,
      messages: [
        { role: "system", content: system },
        ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
          controller.close();
        } catch (err) {
          console.error("[recovery/assistant] stream error", err);
          controller.error(err);
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[recovery/assistant] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `답변 생성 실패: ${detail}` }, { status: 500 });
  }
}
