import { NextRequest, NextResponse } from "next/server";
import { getScenario } from "@/lib/scenarios";
import { SCENARIO_VOICES, typecastRequest } from "@/lib/tts-voices";

export const runtime = "nodejs";
export const maxDuration = 60;

// 동시 요청 한도에 걸렸을 때의 재시도. 한도는 낮지만(실측 Free 2) 스트림이 410~762ms에
// 끝나므로 잠깐 기다리면 자리가 난다. 재시도가 없으면 429가 곧 문장 하나의 무음이 된다 —
// 자막에는 남고 소리만 사라지므로 알아채기도 어렵다.
const RETRY_DELAYS_MS = [200, 500];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// fetch가 던진 이유를 짧은 코드로 뽑는다. Node는 실제 원인을 err.cause에 담는다
// (ENOTFOUND, ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT 등).
//
// 응답에도 실어 보낸다. 배포 환경에서 이 라우트가 죽었을 때 로그 접근 없이 원인을
// 좁힐 수 있어야 한다 — 코드 문자열이라 비밀이 새지 않는다.
function failureCause(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const cause = (err as { cause?: unknown }).cause as
    | { code?: string; message?: string; errors?: Array<{ code?: string }> }
    | undefined;
  // 연결 실패는 AggregateError로 한 겹 더 감싸여 온다. 코드는 그 안에 있다.
  const code = cause?.code ?? cause?.errors?.find((e) => e?.code)?.code;
  if (code) return code;
  // 코드가 없는 경우가 있다. 그때는 원인 객체의 메시지가 유일한 단서다.
  // ("fetch failed"인 바깥 메시지는 쓸모가 없어 안쪽을 본다)
  return (cause?.message ?? err.message ?? err.name ?? "unknown").slice(0, 120);
}

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

  const payload = JSON.stringify(typecastRequest(spec, text, { previous: body.previous, next: body.next }));

  // 끼어들기로 클라이언트가 끊으면 진행 중인 합성도 같이 끊고 싶어 요청 신호를 넘긴다.
  // 다만 런타임에 따라 이 신호를 fetch에 넘기는 것만으로 TypeError가 나는 경우가 있어,
  // 그때는 신호 없이 한 번 더 시도한다. 크레딧이 조금 새더라도 통화가 죽는 것보다 낫다.
  let useSignal = true;
  const call = () =>
    fetch("https://api.typecast.ai/v1/text-to-speech/stream", {
      method: "POST",
      headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: payload,
      ...(useSignal ? { signal: req.signal } : {}),
    });

  try {
    for (let attempt = 0; ; attempt++) {
      let upstream: Response;
      try {
        upstream = await call();
      } catch (err) {
        if (!useSignal || req.signal.aborted) throw err;
        console.error("[voice] 요청 신호를 넘기지 못했습니다. 신호 없이 재시도합니다.", failureCause(err));
        useSignal = false;
        upstream = await call();
      }

      if (upstream.ok && upstream.body) {
        return new Response(upstream.body, {
          headers: {
            "Content-Type": "audio/wav",
            "Cache-Control": "no-store",
          },
        });
      }

      const detail = await upstream.text().catch(() => "");
      const retryable = upstream.status === 429 || upstream.status >= 500;
      if (retryable && attempt < RETRY_DELAYS_MS.length && !req.signal.aborted) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      console.error("[voice] typecast", upstream.status, detail.slice(0, 300));
      return NextResponse.json({ error: `음성 합성 실패 (${upstream.status})` }, { status: 502 });
    }
  } catch (err) {
    // 끼어들기로 클라이언트가 요청을 끊으면 여기로 온다. 오류가 아니다.
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const cause = failureCause(err);
    console.error("[voice] error", cause, err);
    return NextResponse.json({ error: "음성 합성 실패", cause }, { status: 500 });
  }
}

// 통화를 시작하기 전에 이 경로를 쓸 수 있는지 묻는다. 키가 없으면 통화 페이지가
// realtime으로 되돌아간다 — 배포 환경에 키를 넣지 않은 경우가 가장 흔한 실패다.
// 합성을 하지 않으므로 크레딧을 쓰지 않는다.
export async function GET() {
  return NextResponse.json(
    { ready: Boolean(process.env.TYPECAST_API_KEY) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
