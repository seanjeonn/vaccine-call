// 훈련 통화(F1)의 배역별 Typecast 목소리.
//
// lib/scenarios.ts의 scenario.voice("onyx"/"echo"/"shimmer")는 건드리지 않는다. 그 값은
// /api/tts를 쓰는 F3 코파일럿·F4 사무장이 계속 읽는다. lib/realtime-session.ts의
// REALTIME_VOICES가 이미 같은 방식으로 공존하고 있고, 그 선례를 따른다.
//
// 조회 키는 반드시 scenario.id다. resolveScenario가 클라이언트가 보낸 객체를 base 위에
// spread하므로(F1-1 맞춤 시나리오 때문에 필요한 구조), voice_id를 Scenario에 넣으면
// 클라이언트가 임의 목소리를 지정할 수 있게 된다. id는 3종으로 강제되어 있어 안전하다.

import type { ScenarioId } from "@/lib/scenarios";

export const TYPECAST_MODEL = "ssfm-v30";

// 스트리밍 응답은 32kHz/16bit/mono 고정이고 첫 청크에 44바이트 WAV 헤더가 붙는다.
export const TYPECAST_SAMPLE_RATE = 32000;

export type VoiceSpec = {
  voiceId: string;
  /** 프리셋 7종: normal / happy / sad / angry / whisper / toneup / tonedown */
  emotion: string;
  /** 0.0~2.0, 기본 1.0 */
  intensity: number;
  /** 반음, -12~+12 */
  pitch: number;
  /** 0.5~2.0 배속 */
  tempo: number;
};

// 2026-08-20 블라인드 청취로 고른 배정. 전화선 체인(300~3400Hz + µ-law)을 통과시킨
// 상태로 현행 gpt-realtime 목소리와 비교했다. 근거: docs/planning/tts-provider-spike.md
//
// 톤 파라미터는 lib/scenarios.ts의 ttsInstructions를 옮긴 것이다. 다만 그 지시문에는
// 음향으로 표현할 수 없는 것도 섞여 있다 — "사건번호는 외우듯 빠르게 흘려 말하라",
// "'엄마', '아 진짜'를 사이사이 흘려라" 같은 것은 LLM이 텍스트로 써내야 한다.
// 그래서 ttsInstructions는 프롬프트에 그대로 두고, 여기서는 음색만 맡는다.
export const SCENARIO_VOICES: Record<ScenarioId, VoiceSpec> = {
  // 검찰 수사관. 감정을 죽여 사무적으로 만든다.
  institution: {
    voiceId: "tc_682e8798603b4e9ed84074f5", // Hyeongjin
    emotion: "tonedown",
    intensity: 1.2,
    pitch: -2,
    tempo: 0.95,
  },
  // 사고를 냈다는 아들. 프리셋에 "당황·다급"이 없어 sad를 세게 걸고 속도로 조급함을 만든다.
  family: {
    voiceId: "tc_68662745779b66ba84fc4d84", // Seheon
    emotion: "sad",
    intensity: 1.6,
    pitch: 1,
    tempo: 1.12,
  },
  // 저축은행 상담원. 대본을 읽듯 막힘없이.
  loan: {
    voiceId: "tc_691d49ccc47926d741f15913", // Hyoeun
    emotion: "happy",
    intensity: 1.1,
    pitch: 0,
    tempo: 1.12,
  },
};

/** Typecast 스트리밍 요청 본문. 프록시 라우트와 스파이크 스크립트가 공유한다. */
export function typecastRequest(spec: VoiceSpec, text: string, context?: { previous?: string; next?: string }) {
  return {
    voice_id: spec.voiceId,
    text,
    model: TYPECAST_MODEL,
    language: "kor",
    // emotion_type은 판별자다. 프리셋 이름은 emotion_preset에 들어간다.
    prompt: {
      emotion_type: "preset",
      emotion_preset: spec.emotion,
      emotion_intensity: spec.intensity,
      // 문장 단위로 쪼개 보내면 경계에서 억양이 끊긴다. 앞뒤 문장을 문맥으로 넘겨 완화한다.
      ...(context?.previous ? { previous_text: context.previous } : {}),
      ...(context?.next ? { next_text: context.next } : {}),
    },
    // 스트리밍에서는 volume을 못 쓴다. 레벨은 target_lufs로만 맞춘다.
    output: { audio_format: "wav", audio_pitch: spec.pitch, audio_tempo: spec.tempo, target_lufs: -16 },
  };
}
