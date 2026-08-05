import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { resolveScenario } from "@/lib/scenarios";
import { CLERK_VOICE } from "@/lib/recovery";
import { SIM_VICTIM_VOICE } from "@/lib/copilot";

export const runtime = "nodejs";
export const maxDuration = 60;

// 텍스트와 배역을 받아 한국어 TTS 음성(mp3 바이너리)을 반환한다.
// 기본은 훈련 시나리오의 사기범 목소리, persona가 "clerk"이면 피해구제 사무장,
// "victim"이면 코파일럿 체험 모드에서 어르신 역을 읽는 목소리다.
export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const { text, scenario, persona } = (await req.json()) as {
      text: string;
      scenario?: unknown;
      persona?: string;
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text가 필요합니다." },
        { status: 400 },
      );
    }

    const { voice, ttsInstructions } =
      persona === "clerk"
        ? CLERK_VOICE
        : persona === "victim"
          ? SIM_VICTIM_VOICE
          : resolveScenario(scenario);
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
