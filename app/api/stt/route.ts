import { NextRequest, NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// 녹음된 오디오 Blob을 받아 한국어 STT 결과 텍스트를 반환한다.
export async function POST(req: NextRequest) {
  try {
    const openai = new OpenAI();
    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof Blob)) {
      return NextResponse.json(
        { error: "audio 파일이 필요합니다." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    const file = await toFile(buffer, "speech.webm", {
      type: audio.type || "audio/webm",
    });

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
      language: "ko",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    console.error("[stt] error", err);
    return NextResponse.json(
      { error: "음성 인식에 실패했습니다." },
      { status: 500 },
    );
  }
}
