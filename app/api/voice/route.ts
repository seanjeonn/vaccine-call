import { NextRequest, NextResponse } from "next/server";
import { getScenario } from "@/lib/scenarios";
import { SCENARIO_VOICES, typecastRequest } from "@/lib/tts-voices";

export const runtime = "nodejs";
export const maxDuration = 60;

// 훈련 통화(F1)의 사기범 대사 한 조각을 Typecast로 합성해 그대로 흘려보낸다.
//
// 프록시인 이유: Typecast는 X-API-KEY 헤더 인증뿐이고 브라우저용 단일 사용 토큰이 없다.
// 키를 클라이언트에 줄 수 없으므로 경유가 유일한 방법이다. 홉이 하나 늘지만 선택지가 없다.
//
// 응답을 모았다 보내지 않고 그대로 파이프한다. 첫 오디오까지 실측 508ms인데 전체를
// 기다리면 거기에 다운로드 시간이 통째로 더 붙는다. 통화에서는 그 차이가 그대로 체감된다.
export async function POST(req: NextRequest) {
  const key = process.env.TYPECAST_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "TYPECAST_API_KEY가 없습니다." }, { status: 500 });
  }

  let body: { text?: string; scenarioId?: string; previous?: string; next?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text가 필요합니다." }, { status: 400 });
  }
  // 요청당 2000자 제한. 문장 단위로 잘라 보내므로 정상 경로에서는 닿을 일이 없다.
  if (text.length > 2000) {
    return NextResponse.json({ error: "text가 너무 깁니다." }, { status: 400 });
  }

  // voice는 시나리오 id로만 고른다. 클라이언트가 임의 목소리를 지정할 수 없어야 한다.
  const spec = SCENARIO_VOICES[getScenario(body.scenarioId).id];

  try {
    const upstream = await fetch("https://api.typecast.ai/v1/text-to-speech/stream", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify(typecastRequest(spec, text, { previous: body.previous, next: body.next })),
      signal: req.signal,
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("[voice] typecast", upstream.status, detail.slice(0, 300));
      return NextResponse.json({ error: `음성 합성 실패 (${upstream.status})` }, { status: 502 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // 끼어들기로 클라이언트가 요청을 끊으면 여기로 온다. 오류가 아니다.
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error("[voice] error", err);
    return NextResponse.json({ error: "음성 합성 실패" }, { status: 500 });
  }
}
