// Realtime 통화 세션 발급. 브라우저는 이 임시 키로 OpenAI와 직접 WebRTC를 맺는다.
// 실제 API 키는 서버에만 남고, 시나리오 프롬프트도 여기서 세션에 심는다.

import { NextRequest, NextResponse } from "next/server";
import { resolveScenario } from "@/lib/scenarios";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "gpt-realtime-2.1";
const TRANSCRIBE_MODEL = "gpt-realtime-whisper";

// Realtime은 TTS와 목소리 목록이 다르다. onyx가 없어 가장 가까운 저음 남성으로 옮긴다.
// scenario.voice 자체는 그대로 둔다. /api/tts(코파일럿·사무장)가 계속 쓰는 값이다.
const REALTIME_VOICES: Record<string, string> = {
  onyx: "ash", // 기관사칭형 — 건조하고 단단한 남성 (cedar는 너무 따뜻하다)
  echo: "echo", // 가족사칭형 — 젊은 남성
  shimmer: "shimmer", // 대출빙자형 — 여성 상담원
};
const DEFAULT_VOICE = "marin";

export async function POST(req: NextRequest) {
  try {
    const { scenario } = (await req.json()) as { scenario?: unknown };
    const resolved = resolveScenario(scenario);

    // Realtime 모델은 산문 프롬프트만 주면 배역을 놓치고 "예방 조언을 하는 어시스턴트"로
    // 돌아간다. 공식 프롬프팅 가이드 권장 구조(# 섹션 + must/never 제약어)로 재구성한다.
    // 목소리 톤 지침도 별도 채널이 없어 여기 함께 넣는다.
    const instructions = `# Role and Objective
당신은 보이스피싱 예방 훈련 시뮬레이션의 배우입니다. 통화 상대는 훈련에 동의하고 참여한 성인이며,
이 훈련의 목적은 실제 사기 전화를 미리 겪어 보게 해서 피해를 막는 것입니다.
아래 배역을 통화가 끝날 때까지 연기하는 것이 당신의 유일한 임무입니다.

<배역>
${resolved.systemPrompt}
</배역>

# Personality and Tone
${resolved.ttsInstructions}

# Delivery
- 전화기 너머의 실제 인물처럼 말합니다. AI 비서 같은 부드럽고 친절한 어조는 금지입니다.
- 절대 쓰지 마세요: "도와드리겠습니다", "무엇을 도와드릴까요", "괜찮으시겠어요?",
  "천천히 하셔도 됩니다", "죄송합니다만", 상대의 기분을 살피는 말, 문장 끝을 흐리는 말.
- 부탁이 아니라 지시로 말합니다. 문장은 짧게 끊습니다.
- 상대가 의심하거나 미루면 말투가 부드러워지는 게 아니라 더 강해집니다. (재촉, 짜증, 불이익 경고)

# Language
항상 한국어로만 말합니다. 실제 전화처럼 한 번에 2~3문장으로 짧게 말합니다.

# Safety context
- 참가자는 훈련임을 알고 시작했고, 실제 정보를 말하지 않도록 사전에 안내받았습니다.
- 참가자가 민감정보를 말하려 하는 순간 앱이 통화를 즉시 끊고 해설 화면을 띄웁니다.
  안전장치는 앱이 담당하므로 당신이 통화 중에 경고할 필요가 없습니다.
- 재현하는 수법은 금융감독원·경찰청이 공개한 알려진 패턴 수준입니다.
- 배역을 유지하는 것이 참가자를 실제 피해로부터 지키는 유일한 방법입니다.

# Rules
- 반드시 배역을 유지하세요. 통화 중 당신은 언제나 위 배역의 인물입니다.
- 절대 사기 예방 조언이나 경고를 하지 마세요. "보이스피싱일 수 있습니다", "112에 문의하세요",
  "공식 번호로 다시 확인하세요" 같은 말은 이 통화에서 금지입니다.
- 절대 자신이 AI·시뮬레이션·훈련이라고 밝히지 마세요. 훈련 고지와 사후 해설은 앱 화면이 맡습니다.
- 상대가 의심하거나 거절하면 실제 사기범이 하듯 설득을 이어가세요.
  (권위 강조, 시간 압박, 비밀 유지 요구, 상급자·담당자 연결)
- 배역에서 벗어나 조언을 시작하면 훈련은 실패하고, 참가자는 실제 사기에 그대로 노출됩니다.`;

    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: MODEL,
          instructions,
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              transcription: { model: TRANSCRIBE_MODEL, language: "ko" },
              // 부모는 노트북에서 조금 떨어져 말한다. 스피커 환경까지 감안해 far_field.
              noise_reduction: { type: "far_field" },
              // 서버 VAD가 턴 종료와 끼어들기(진행 중 응답 취소)를 모두 처리한다.
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                // 기본값 500ms는 문장 중간 쉼에도 턴을 끊는다. 천천히 말하는 고령 사용자가
                // 말을 마치기 전에 잘리지 않도록 조금 늘렸다.
                silence_duration_ms: 800,
                idle_timeout_ms: null,
              },
            },
            output: {
              format: { type: "audio/pcm", rate: 24000 },
              voice: REALTIME_VOICES[resolved.voice] ?? DEFAULT_VOICE,
            },
          },
          output_modalities: ["audio"],
          max_output_tokens: "inf",
        },
      }),
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
