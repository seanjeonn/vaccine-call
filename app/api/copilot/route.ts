// 진행 중인 통화의 분석 틱(F3-1~F3-3). 5초 안팎으로 들어오는 새 발화를 받아
// 화자를 나누고, 사기 각본의 어느 단계까지 왔는지와 위험도를 갱신한다.
//
// 판정에 필요한 이전 상태(단계·위험도·앞선 대화)는 요청이 아니라 LiveCall 행에서 읽는다.
// 클라이언트가 상태를 들고 다니면 틱이 겹칠 때 어긋난다.

import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notifyChild } from "@/lib/notifications";
import {
  ALERT_RISK_THRESHOLD,
  RISK_DECAY_MAX,
  type CopilotAnalysis,
  type CopilotLine,
  type CopilotScamType,
  type CopilotStage,
} from "@/lib/copilot";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o-mini";

// 판정 맥락으로 넘길 직전 발화 수. 통화가 길어져도 프롬프트가 무한정 커지지 않게 자른다.
const CONTEXT_LINES = 20;

const STAGE_IDS: CopilotStage[] = [
  "none",
  "approach",
  "pressure",
  "isolation",
  "extraction",
];
const SCAM_TYPE_IDS: CopilotScamType[] = [
  "institution",
  "family",
  "loan",
  "unknown",
];

// strict 모드라 모든 필드가 required다. evidence는 근거가 없을 때 빈 문자열로 둔다.
const COPILOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lines", "stage", "risk", "scamType", "summary", "evidence"],
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["speaker", "text"],
        properties: {
          speaker: { type: "string", enum: ["caller", "victim"] },
          text: { type: "string" },
        },
      },
    },
    stage: { type: "string", enum: STAGE_IDS },
    risk: { type: "integer" },
    scamType: { type: "string", enum: SCAM_TYPE_IDS },
    summary: { type: "string" },
    evidence: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `당신은 지금 진행 중인 실제 전화 통화를 옆에서 지켜보는 보이스피싱 감시 AI입니다. 전화를 받은 사람은 고령의 어르신이고, 통화는 스피커폰으로 녹음되어 두 사람의 목소리가 한 채널에 섞여 들어옵니다.

작업 1 — 화자 분리
새로 들어온 발화를 문장 단위로 나눠 caller(전화를 건 상대방)와 victim(전화를 받은 어르신)으로 표시하세요. 내용으로 판단하면 됩니다. 지시하고 요구하는 쪽이 caller, 대답하고 되묻는 쪽이 victim입니다.

작업 2 — 사기 진행 단계(stage)
보이스피싱은 아래 각본을 순서대로 밟습니다. 통화 전체 맥락에서 가장 진행된 신호를 고르세요.
- approach(접근): 검찰·경찰·금융감독원·은행·자녀를 사칭하고, 사건번호·계좌 연루·대출 승인 등을 언급해 신뢰를 만든다.
- pressure(압박): 구속·처벌·계좌 동결·합의금 시한을 들어 공포와 시간 압박을 준다.
- isolation(격리): "가족에게 말하지 마라", "전화를 끊지 마라", 앱 설치, 은행 창구에서 할 말 지정, 특정 장소로 이동 지시.
- extraction(송금 유도): 안전계좌 이체, 현금 인출·전달, 상품권 구매, 계좌번호·비밀번호·OTP 요구.
- none: 위 신호가 없는 평범한 통화(택배, 지인, 영업 전화 등).

작업 3 — 위험도(risk, 0~100)
- none 0~15 · approach 20~39 · pressure 40~59 · isolation 55~74 · extraction 75~95
- 어르신이 순응하면(개인정보를 말함, "지금 은행 가겠다") +10
- 어르신이 의심하거나 거절하거나 직접 확인하려 하면 -10
- 이전 판정보다 크게 낮추지 마세요. 사기 각본은 뒤로 물러나지 않습니다.

작업 4 — 수법 분류(scamType)
institution(기관사칭) · family(가족사칭) · loan(대출빙자) · unknown(아직 모르겠음)

작업 5 — 요약(summary)
멀리 있는 자녀가 읽고 상황을 파악할 한 문장. 존댓말로, 과장 없이 사실만.

기타
- evidence: 판정 근거가 된 상대방 발화를 그대로 짧게 발췌하세요. 없으면 빈 문자열.
- 평범한 통화를 사기로 몰지 마세요. 애매하면 낮은 단계를 고르세요.`;

function formatContext(recent: CopilotLine[]) {
  if (recent.length === 0) return "(없음)";
  return recent
    .map((l) => `${l.speaker === "caller" ? "상대방" : "어르신"}: ${l.text}`)
    .join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (session?.role !== "parent" || !session.parentId) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const { callId, newText, newLines } = (await req.json()) as {
      callId?: string;
      newText?: string;
      newLines?: CopilotLine[];
    };

    if (typeof callId !== "string" || !callId) {
      return NextResponse.json({ error: "callId가 필요합니다." }, { status: 400 });
    }

    // 체험 모드는 대본이라 화자를 이미 안다. 실전은 STT 원문만 온다.
    const prelabeled = Array.isArray(newLines) && newLines.length > 0;
    const heard = prelabeled
      ? newLines.map((l) => l.text).join(" ")
      : (newText ?? "").trim();
    if (!heard) {
      return NextResponse.json({ error: "분석할 내용이 없습니다." }, { status: 400 });
    }

    const call = await prisma.liveCall.findFirst({
      where: { id: callId, parentId: session.parentId },
      include: { parent: { select: { childId: true, name: true } } },
    });
    if (!call) {
      return NextResponse.json({ error: "통화를 찾을 수 없습니다." }, { status: 404 });
    }

    const transcript = (call.transcript as unknown as CopilotLine[]) ?? [];
    const prevStage = call.stage as CopilotStage;

    const openai = new OpenAI();
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "copilot_analysis", strict: true, schema: COPILOT_SCHEMA },
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `지금까지의 통화:\n${formatContext(transcript.slice(-CONTEXT_LINES))}`,
            `\n이전 판정: 단계 ${prevStage} · 위험도 ${call.risk}`,
            prelabeled
              ? `\n새로 들어온 발화(화자 확인됨):\n${formatContext(newLines)}`
              : `\n새로 들어온 발화(화자 미상):\n${heard}`,
          ].join("\n"),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return NextResponse.json({ error: "분석 결과가 비어 있습니다." }, { status: 502 });
    }
    const parsed = JSON.parse(raw) as CopilotAnalysis;

    // 화자가 확정된 입력은 LLM이 다시 쓰게 두지 않는다.
    const lines = prelabeled ? newLines : parsed.lines;
    // 게이지가 깜빡이지 않도록 한 틱에 내려갈 수 있는 폭을 제한한다.
    const risk = Math.max(
      0,
      Math.min(100, Math.max(parsed.risk, call.risk - RISK_DECAY_MAX)),
    );
    // 한 번 수법이 잡히면 유지한다. 중간에 unknown으로 돌아가면 화면 표시가 흔들린다.
    const scamType =
      parsed.scamType === "unknown" && call.scamType !== "unknown"
        ? (call.scamType as CopilotScamType)
        : parsed.scamType;

    const shouldAlert = risk >= ALERT_RISK_THRESHOLD || parsed.stage === "extraction";

    await prisma.liveCall.update({
      where: { id: call.id },
      data: {
        stage: parsed.stage,
        risk,
        scamType,
        summary: parsed.summary,
        transcript: [...transcript, ...lines] as unknown as Prisma.InputJsonValue,
      },
    });

    // 자녀에게는 통화당 한 번만 알린다. 틱이 겹쳐도 한 건만 나가도록
    // alertedAt이 비어 있을 때만 차지하는 방식으로 잠근다.
    let alerted = call.alertedAt !== null;
    if (shouldAlert && !alerted) {
      try {
        const claimed = await prisma.liveCall.updateMany({
          where: { id: call.id, alertedAt: null },
          data: { alertedAt: new Date() },
        });
        if (claimed.count === 1) {
          await notifyChild(call.parent.childId, {
            type: "risk",
            title: `${call.parent.name}님이 지금 의심 전화를 받고 있어요`,
            body: `${parsed.summary} 지금 바로 전화해 확인해 주세요.`,
          });
        }
        alerted = true;
      } catch (err) {
        // 알림이 실패해도 화면의 개입 안내는 계속 떠야 한다.
        console.error("[copilot] alert failed", err);
      }
    }

    return NextResponse.json({
      lines,
      stage: parsed.stage,
      risk,
      scamType,
      summary: parsed.summary,
      evidence: parsed.evidence,
      alerted,
    });
  } catch (err) {
    console.error("[copilot] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `통화 분석 실패: ${detail}` }, { status: 500 });
  }
}
