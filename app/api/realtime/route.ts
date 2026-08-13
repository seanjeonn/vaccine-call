// Realtime 통화 세션 발급. 브라우저는 이 임시 키로 OpenAI와 직접 WebRTC를 맺는다.
// 실제 API 키는 서버에만 남는다. 세션 설정·배역 프롬프트는 lib/realtime-session.ts.

import { NextRequest, NextResponse } from "next/server";
import { resolveScenario } from "@/lib/scenarios";
import { buildSessionConfig } from "@/lib/realtime-session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { scenario } = (await req.json()) as { scenario?: unknown };
    const session = buildSessionConfig(resolveScenario(scenario));

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("[realtime] client_secrets 실패", res.status, detail);
      return NextResponse.json(
        { error: `통화 세션 발급 실패 (${res.status})` },
        { status: 500 },
      );
    }

    const data = (await res.json()) as { value: string };
    return NextResponse.json({ value: data.value });
  } catch (err) {
    console.error("[realtime] error", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `통화 세션 발급 실패: ${detail}` },
      { status: 500 },
    );
  }
}
