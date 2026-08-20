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
// 응답에 실어 보내도 안전한 값만 돌려준다.
//
// 한때 여기서 원인 객체의 메시지를 그대로 넘겼는데, 헤더 검증 실패 메시지에는 문제가 된
// 헤더 값이 통째로 들어 있다. 그 값이 API 키였고, 이 라우트는 인증이 없어 누구나 호출할
// 수 있다. 진단을 위해 메시지를 노출하는 것은 이 라우트에서는 선택지가 아니다.
const KNOWN_CAUSES = [
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "AbortError",
];

function failureCause(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const cause = (err as { cause?: unknown }).cause as
    | { code?: string; message?: string; errors?: Array<{ code?: string }> }
    | undefined;
  // 연결 실패는 AggregateError로 한 겹 더 감싸여 온다. 코드는 그 안에 있다.
  const code = cause?.code ?? cause?.errors?.find((e) => e?.code)?.code;
  if (code && KNOWN_CAUSES.includes(code)) return code;
  if (code) return "upstream_error";
  // 코드가 없으면 헤더·인자 검증 실패일 가능성이 크다. 메시지에 값이 실려 오므로
  // 분류만 하고 내용은 버린다. 실제 메시지는 서버 로그에만 남는다.
  if (/Headers\.|header/i.test(cause?.message ?? "")) return "invalid_header_value";
  return "request_failed";
}

// 훈련 통화(F1)의 사기범 대사 한 조각을 Typecast로 합성해 그대로 흘려보낸다.
//
// 프록시인 이유: Typecast는 X-API-KEY 헤더 인증뿐이고 브라우저용 단일 사용 토큰이 없다.
// 키를 클라이언트에 줄 수 없으므로 경유가 유일한 방법이다. 홉이 하나 늘지만 선택지가 없다.
//
// 응답을 모았다 보내지 않고 그대로 파이프한다. 첫 오디오까지 실측 508ms인데 전체를
// 기다리면 거기에 다운로드 시간이 통째로 더 붙는다. 통화에서는 그 차이가 그대로 체감된다.
// 환경변수에 값을 넣을 때 "이름=값" 줄을 통째로 붙여넣는 사고가 있었다. 그러면 헤더로
// 쓸 수 없는 값이 되어 fetch가 던지고, 통화 목소리가 통째로 죽는다. 앞뒤 공백과 개행,
// 실수로 붙은 이름 접두사를 걷어내되 로그로 남겨 설정을 고칠 수 있게 한다.
function readApiKey(): string | null {
  const raw = process.env.TYPECAST_API_KEY?.trim();
  if (!raw) return null;
  const stripped = raw.replace(/^TYPECAST_API_KEY\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
  if (stripped !== raw) {
    console.warn("[voice] TYPECAST_API_KEY에 이름 접두사나 따옴표가 섞여 있습니다. 환경변수를 값만 남겨 정리하세요.");
  }
  // 헤더로 쓸 수 없는 문자가 남아 있으면 fetch가 던지기 전에 여기서 잡는다.
  return /^[\x21-\x7e]+$/.test(stripped) ? stripped : null;
}

export async function POST(req: NextRequest) {
  const key = readApiKey();
  if (!key) {
    return NextResponse.json({ error: "TYPECAST_API_KEY가 없거나 형식이 올바르지 않습니다." }, { status: 500 });
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
    { ready: Boolean(readApiKey()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
