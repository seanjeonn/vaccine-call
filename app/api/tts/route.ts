import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// 사기꾼 톤 지시. PoC에서 톤 반영 정도를 함께 검증한다.
const TONE_INSTRUCTIONS =
  "낮고 위압적인 40대 남성 검사·수사관 목소리로, 단호하고 사무적이며 상대를 압박하듯 말하세요.";

// 텍스트를 받아 한국어 TTS 음성(mp3 바이너리)을 반환한다.
export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { text } = (await req.json()) as { text: string };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text가 필요합니다." },
        { status: 400 },
      );
    }

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "onyx",
      input: text,
      instructions: TONE_INSTRUCTIONS,
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
    return NextResponse.json(
      { error: "음성 합성에 실패했습니다." },
      { status: 500 },
    );
  }
}
