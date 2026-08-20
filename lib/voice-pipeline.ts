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

// 검증이 끝날 때까지 기본값은 realtime이다. 무중단이 결격 조건이라 기본값을 옮기는 것은
// 지연·끼어들기·자멸 없음이 전부 확인된 뒤에 한다.
export const DEFAULT_PIPELINE: VoicePipeline = "realtime";

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
