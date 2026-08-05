import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveScenario } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

// 텍스트와 시나리오를 받아 배역에 맞는 한국어 TTS 음성(mp3 바이너리)을 반환한다.
export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { text, scenario } = (await req.json()) as {
      text: string;
      scenario?: unknown;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text가 필요합니다." },
        { status: 400 },
      );
    }

    const { voice, ttsInstructions } = resolveScenario(scenario);
    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      instructions: ttsInstructions,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[tts] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `음성 합성 실패: ${detail}` },
      { status: 500 },
    );
  }
}
