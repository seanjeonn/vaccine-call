import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getScenario } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o";

type ChatMessage = { role: "user" | "assistant"; content: string };

// 대화 이력과 시나리오를 받아 사기꾼 롤플레이 응답 텍스트를 반환한다.
export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { messages, scenario } = (await req.json()) as {
      messages: ChatMessage[];
      scenario?: string;
    };

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages 배열이 필요합니다." },
        { status: 400 },
      );
    }

    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 400,
      messages: [
        { role: "system", content: getScenario(scenario).systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const text = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({ text });
  } catch (err) {
    console.error("[chat] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `응답 생성 실패: ${detail}` },
      { status: 500 },
    );
  }
}
