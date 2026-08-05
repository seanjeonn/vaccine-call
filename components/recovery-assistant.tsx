"use client";

import { useRef, useState } from "react";
import type { AssistantContext } from "@/lib/recovery";

type Message = { role: "user" | "assistant"; content: string };

// 회복 화면 어디서나 부를 수 있는 AI 사무장(F4). 절차 전 과정에서 곁에 둔다.
// 첫인사와 추천 질문은 지금 단계에 맞춰 서버에서 계산해 넘겨받는다.
export default function RecoveryAssistant({ context }: { context: AssistantContext }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    const history = [...messages, { role: "user" as const, content: trimmed }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/recovery/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "답변을 받지 못했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        // 마지막 말풍선만 계속 덮어쓴다.
        setMessages([...history, { role: "assistant", content: answer }]);
        endRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    } catch (err) {
      setMessages(history);
      setError(err instanceof Error ? err.message : "답변을 받지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // 눈이 어두우신 분을 위해 답변을 소리로도 들려준다 (PRD §5 음성 안내).
  async function speak(index: number, text: string) {
    audioRef.current?.pause();
    if (speakingIndex === index) {
      setSpeakingIndex(null);
      return;
    }

    setSpeakingIndex(index);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, persona: "clerk" }),
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setSpeakingIndex(null);
      };
      await audio.play();
    } catch {
      setSpeakingIndex(null);
      setError("소리로 들려드리지 못했어요.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sticky bottom-4 rounded-full bg-sky-600 py-5 text-xl font-bold text-white shadow-lg transition hover:bg-sky-500"
      >
        💬 사무장에게 물어보기
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div>
          <h2 className="text-xl font-bold">AI 사무장</h2>
          <p className="text-base text-neutral-500">피해 구제 절차를 도와드려요</p>
        </div>
        <button
          type="button"
          onClick={() => {
            audioRef.current?.pause();
            setSpeakingIndex(null);
            setOpen(false);
          }}
          className="rounded-full bg-neutral-800 px-5 py-3 text-lg font-bold"
        >
          닫기
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <p className="rounded-2xl bg-neutral-900 px-5 py-4 text-xl leading-relaxed">
          {context.greeting}
        </p>

        {messages.map((message, index) =>
          message.role === "user" ? (
            <p
              key={index}
              className="ml-8 rounded-2xl bg-sky-600 px-5 py-4 text-xl leading-relaxed text-white"
            >
              {message.content}
            </p>
          ) : (
            <div key={index} className="rounded-2xl bg-neutral-900 px-5 py-4">
              <p className="whitespace-pre-wrap text-xl leading-relaxed">
                {message.content || "…"}
              </p>
              {message.content && !busy && (
                <button
                  type="button"
                  onClick={() => speak(index, message.content)}
                  className="mt-3 rounded-full bg-neutral-800 px-4 py-2 text-lg"
                >
                  {speakingIndex === index ? "■ 멈추기" : "🔊 들려주세요"}
                </button>
              )}
            </div>
          ),
        )}

        {error && (
          <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
        )}

        {!busy && (
          <div className="flex flex-col gap-2 pt-2">
            {context.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                className="rounded-2xl border-2 border-neutral-700 px-5 py-4 text-left text-lg transition hover:border-neutral-500"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="flex gap-2 border-t border-neutral-800 px-5 py-4"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="궁금한 것을 물어보세요"
          className="min-w-0 flex-1 rounded-xl border-2 border-neutral-700 bg-neutral-900 px-4 py-4 text-xl"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-xl bg-sky-600 px-6 text-xl font-bold text-white disabled:opacity-40"
        >
          {busy ? "…" : "물어보기"}
        </button>
      </form>
    </div>
  );
}
