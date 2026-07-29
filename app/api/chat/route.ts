import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getScenario } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-4o";

type ChatMessage = { role: "user" | "assistant"; content: string };

// 대화 이력과 시나리오를 받아 사기꾼 롤플레이 응답을 텍스트 스트림으로 흘려보낸다.
// 클라이언트가 문장이 완성되는 대로 TTS를 먼저 태울 수 있게 하려는 목적이라 JSON이 아닌
// 순수 텍스트 청크를 그대로 내보낸다.
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
      stream: true,
      messages: [
        { role: "system", content: getScenario(scenario).systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
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
          // 스트림이 시작된 뒤의 오류는 상태 코드로 알릴 수 없다. 끊어서 알린다.
          console.error("[chat] stream error", err);
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
    console.error("[chat] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `응답 생성 실패: ${detail}` },
      { status: 500 },
    );
  }
}
