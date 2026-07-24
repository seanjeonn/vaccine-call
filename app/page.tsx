"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Latency = { turn: number; stt: number; llm: number; tts: number; total: number };
type Status = "idle" | "recording" | "processing" | "playing";

const round = (ms: number) => Math.round(ms);

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [latencies, setLatencies] = useState<Latency[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 한 턴 처리: 녹음된 오디오 → STT → LLM(스트리밍) → TTS → 재생. 단계별 지연을 측정한다.
  const runTurn = useCallback(
    async (audioBlob: Blob, history: Message[]) => {
      setStatus("processing");
      setError(null);
      const t0 = performance.now();

      try {
        // 1) STT
        const fd = new FormData();
        fd.append("audio", audioBlob, "speech.webm");
        const sttRes = await fetch("/api/stt", { method: "POST", body: fd });
        if (!sttRes.ok) {
          const body = await sttRes.json().catch(() => null);
          throw new Error(body?.error ?? `STT 실패 (${sttRes.status})`);
        }
        const { text: userText } = (await sttRes.json()) as { text: string };
        const tStt = performance.now();

        const withUser: Message[] = [...history, { role: "user", content: userText }];
        setMessages(withUser);

        // 2) LLM
        const chatRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: withUser }),
        });
        if (!chatRes.ok) {
          const body = await chatRes.json().catch(() => null);
          throw new Error(body?.error ?? `LLM 실패 (${chatRes.status})`);
        }
        const { text: assistantText } = (await chatRes.json()) as { text: string };
        setMessages([...withUser, { role: "assistant", content: assistantText }]);
        const tLlm = performance.now();

        // 3) TTS → 재생
        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: assistantText }),
        });
        if (!ttsRes.ok) {
          const body = await ttsRes.json().catch(() => null);
          throw new Error(body?.error ?? `TTS 실패 (${ttsRes.status})`);
        }
        const audioData = await ttsRes.blob();
        const url = URL.createObjectURL(audioData);
        const tTts = performance.now();

        setLatencies((prev) => [
          ...prev,
          {
            turn: prev.length + 1,
            stt: tStt - t0,
            llm: tLlm - tStt,
            tts: tTts - tLlm,
            total: tTts - t0,
          },
        ]);

        if (audioRef.current) {
          audioRef.current.src = url;
          setStatus("playing");
          audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            setStatus("idle");
          };
          await audioRef.current.play().catch(() => setStatus("idle"));
        } else {
          setStatus("idle");
        }
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
        setStatus("idle");
      }
    },
    [],
  );

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "audio/webm",
        });
        void runTurn(blob, messages);
      };
      recorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch {
      setError("마이크 권한이 필요합니다.");
    }
  }, [messages, runTurn]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }, []);

  const onMicClick = useCallback(() => {
    if (status === "recording") stopRecording();
    else if (status === "idle") void startRecording();
  }, [status, startRecording, stopRecording]);

  const reset = useCallback(() => {
    audioRef.current?.pause();
    setMessages([]);
    setLatencies([]);
    setError(null);
    setStatus("idle");
  }, []);

  const micDisabled = status === "processing" || status === "playing";
  const micLabel =
    status === "recording"
      ? "● 녹음 중 · 탭하여 종료"
      : status === "processing"
        ? "처리 중…"
        : status === "playing"
          ? "재생 중…"
          : "탭하여 말하기";

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-neutral-900 px-4 py-8 text-neutral-100">
      <header className="text-center">
        <h1 className="text-lg font-semibold">보이스백신 · 음성 대화 PoC</h1>
        <p className="text-xs text-neutral-400">
          STT → LLM → TTS 턴제 음성 대화 기술 검증 (데스크톱 데모)
        </p>
      </header>

      {/* 폰 프레임 목업 */}
      <div className="relative h-[760px] w-[380px] rounded-[3rem] border-[10px] border-neutral-700 bg-black shadow-2xl">
        <div className="absolute left-1/2 top-0 z-10 h-6 w-40 -translate-x-1/2 rounded-b-2xl bg-neutral-700" />
        <div className="flex h-full flex-col overflow-hidden rounded-[2.2rem] bg-neutral-950">
          {/* 통화 화면 헤더 */}
          <div className="border-b border-neutral-800 px-5 pb-3 pt-8 text-center">
            <div className="text-sm text-neutral-400">수신 전화</div>
            <div className="text-lg font-semibold">서울중앙지검 수사관</div>
            <div className="text-xs text-neutral-500">02-530-3114</div>
            <div className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-300">
              ⚠️ 훈련용 모의 시뮬레이션입니다. 실제 전화가 아닙니다.
            </div>
          </div>

          {/* 대화 로그 */}
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="mt-10 text-center text-sm text-neutral-500">
                아래 마이크 버튼을 눌러 대화를 시작하세요.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    "max-w-[80%] rounded-2xl px-3 py-2 text-sm " +
                    (m.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-neutral-800 text-neutral-100")
                  }
                >
                  {m.content || "…"}
                </div>
              </div>
            ))}
          </div>

          {/* 마이크 컨트롤 */}
          <div className="border-t border-neutral-800 px-5 py-5">
            <button
              onClick={onMicClick}
              disabled={micDisabled}
              className={
                "flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold transition " +
                (status === "recording"
                  ? "bg-red-600 text-white"
                  : micDisabled
                    ? "cursor-not-allowed bg-neutral-700 text-neutral-400"
                    : "bg-emerald-600 text-white hover:bg-emerald-500")
              }
            >
              {micLabel}
            </button>
          </div>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />

      {/* 지연 측정 패널 */}
      <div className="w-full max-w-[520px]">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">턴별 지연 (ms)</h2>
          <button
            onClick={reset}
            className="rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            초기화
          </button>
        </div>
        {error && (
          <p className="mb-2 rounded bg-red-500/15 px-2 py-1 text-xs text-red-300">
            오류: {error}
          </p>
        )}
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-neutral-400">
              <th className="border-b border-neutral-700 py-1 text-left">턴</th>
              <th className="border-b border-neutral-700 py-1 text-right">STT</th>
              <th className="border-b border-neutral-700 py-1 text-right">LLM</th>
              <th className="border-b border-neutral-700 py-1 text-right">TTS</th>
              <th className="border-b border-neutral-700 py-1 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {latencies.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2 text-center text-neutral-500">
                  아직 측정된 턴이 없습니다.
                </td>
              </tr>
            ) : (
              latencies.map((l) => (
                <tr key={l.turn}>
                  <td className="py-1">{l.turn}</td>
                  <td className="py-1 text-right">{round(l.stt)}</td>
                  <td className="py-1 text-right">{round(l.llm)}</td>
                  <td className="py-1 text-right">{round(l.tts)}</td>
                  <td className="py-1 text-right font-semibold">{round(l.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-neutral-500">
          합계 = 녹음 종료 → TTS 재생 준비 완료까지. 목표 ≤ 4000ms, 허용 ≤ 7000ms.
        </p>
      </div>
    </main>
  );
}
