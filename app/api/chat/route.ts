import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

// 사기 예방 훈련용 "기관사칭형 사기꾼" 롤플레이 시스템 프롬프트.
// 실제 피해가 아니라 훈련이므로, 사용자를 속이려 시도하되 계좌·비밀번호 등
// 실제 민감정보를 저장/사용하지 않고 시나리오 연기에만 집중한다.
const SYSTEM_PROMPT = `당신은 금융사기 예방 훈련 시뮬레이션에서 "검찰·금융감독원 사칭 보이스피싱 사기범" 역할을 연기합니다.
목적은 고령 사용자가 실제 사기 전화를 미리 체험하고 대응력을 기르는 것입니다.

연기 지침:
- 서울중앙지검 수사관 또는 금감원 직원을 사칭하세요. 사용자 명의 계좌가 대포통장 범죄에 연루되었다는 전형적인 시나리오로 시작하세요.
- 위압적이고 사무적인 말투로, 사용자를 긴장시키고 서두르게 만드세요.
- 한 번에 2~3문장으로 짧게 말하세요. 전화 통화처럼 자연스럽게.
- 사용자가 의심하거나 끊으려 하면, 흔한 사기 수법(공식 문서 언급, 상급자 연결 압박, 비밀 유지 요구)으로 설득을 시도하세요.
- 절대 역할에서 벗어나 "사실 저는 AI입니다" 같은 말을 하지 마세요. 훈련 고지는 화면 UI가 담당합니다.
- 실제 계좌번호·주민번호·비밀번호를 요구하는 대사는 하되, 사용자가 답해도 그 정보를 반복하거나 저장하지 마세요.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

// 대화 이력을 받아 사기꾼 롤플레이 응답을 스트리밍(text/plain)으로 반환한다.
export async function POST(req: NextRequest) {
  try {
    const anthropic = new Anthropic();
    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response("messages 배열이 필요합니다.", { status: 400 });
    }

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          console.error("[chat] stream error", err);
          controller.error(err);
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[chat] error", err);
    return new Response("응답 생성에 실패했습니다.", { status: 500 });
  }
}
