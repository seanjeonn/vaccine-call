// 훈련 통화(F1)의 목소리를 어디서 만들지 고르는 스위치.
//
//   realtime — gpt-realtime-2.1이 음성을 직접 낸다. 지금까지의 동작 그대로다.
//   typecast — Realtime을 텍스트 출력으로 돌리고 음성만 Typecast로 만든다.
//
// 데모 중 롤백이 재배포를 요구하면 안 된다. 그래서 소스 상수가 아니라 URL 쿼리를
// 최우선으로 둔다 — 심사위원 노트북에서 /call?pipeline=realtime 한 줄이면 되돌아간다.
// 우선순위: ?pipeline= > NEXT_PUBLIC_VOICE_PIPELINE > DEFAULT_PIPELINE

export type VoicePipeline = "realtime" | "typecast";

const PIPELINES: VoicePipeline[] = ["realtime", "typecast"];

// 훈련 통화의 기본 목소리. 블라인드 청취에서 Typecast가 현행보다 확실히 낫다는 판정이
// 나와 기본값을 옮겼다(2026-08-21). 대가는 지연 +427ms(p50)이고, 근거와 수치는
// docs/planning/tts-provider-spike.md에 있다.
//
// 되돌리는 방법은 두 가지다 — 환경변수 NEXT_PUBLIC_VOICE_PIPELINE=realtime,
// 또는 통화 URL에 ?pipeline=realtime. 후자는 재배포가 필요 없어 데모 중 비상 레버다.
// Typecast 키가 없거나 응답하지 않으면 통화 페이지가 알아서 realtime으로 되돌아간다.
export const DEFAULT_PIPELINE: VoicePipeline = "typecast";

function parse(value: string | null | undefined): VoicePipeline | null {
  return PIPELINES.find((p) => p === value) ?? null;
}

export function resolvePipeline(search?: URLSearchParams | null): VoicePipeline {
  return (
    parse(search?.get("pipeline")) ??
    parse(process.env.NEXT_PUBLIC_VOICE_PIPELINE) ??
    DEFAULT_PIPELINE
  );
}
