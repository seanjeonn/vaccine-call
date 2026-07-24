"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCENARIOS, type Scenario } from "@/lib/scenarios";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Latency = {
  turn: number;
  stt: number | null;
  llm: number;
  tts: number;
  total: number;
};
type Status = "idle" | "connecting" | "speaking" | "listening" | "processing";

const round = (ms: number) => Math.round(ms);

// --- VAD 튜닝 상수 (데스크톱 Chrome 기준 시작값) ---
const VAD_INTERVAL_MS = 50; // RMS 샘플링 주기
const VAD_RMS_THRESHOLD = 0.02; // 발화 판정 임계값 (환경 따라 0.01~0.05)
const VAD_MIN_SPEECH_MS = 300; // 이만큼 누적 발화해야 "말했다" 인정 (기침·잡음 방지)
const VAD_SILENCE_MS = 1500; // 발화 후 이 시간 침묵이면 턴 종료
const VAD_MAX_UTTERANCE_MS = 30000; // 최대 발화 안전장치

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [latencies, setLatencies] = useState<Latency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadTimerRef = useRef<number | null>(null);
  const callActiveRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const ringbackRef = useRef<{ stop: () => void } | null>(null);

  // 상호 재귀 함수들의 stale 참조를 피하기 위한 간접 참조.
  const startListeningRef = useRef<() => void>(() => {});

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const setConversation = useCallback((next: Message[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // 통화 관련 리소스를 모두 해제한다. (통화 종료·오류 공통)
  const teardown = useCallback(() => {
    callActiveRef.current = false;
    ringbackRef.current?.stop();
    if (vadTimerRef.current !== null) {
      clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null; // runTurn 트리거 방지
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    scenarioRef.current = null;
    setScenario(null);
  }, []);

  const endCall = useCallback(() => {
    teardown();
    setStatus("idle");
  }, [teardown]);

  const failCall = useCallback(
    (message: string) => {
      console.error(message);
      setError(message);
      teardown();
      setStatus("idle");
    },
    [teardown],
  );

  // 통화 연결음(ringback)을 오실레이터로 합성해 즉시 울린다. 오프닝 대기 체감을 줄인다.
  const startRingback = useCallback((ctx: AudioContext) => {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.frequency.value = 440;
    osc2.frequency.value = 480;
    osc1.connect(gain);
    osc2.connect(gain);
    osc1.start();
    osc2.start();
    // 1초 울림 / 2초 침묵 반복 (통화 연결음 근사)
    let slot = 0;
    const ring = () => {
      gain.gain.setTargetAtTime(slot === 0 ? 0.06 : 0, ctx.currentTime, 0.02);
      slot = (slot + 1) % 3;
    };
    ring();
    const timer = window.setInterval(ring, 1000);
    ringbackRef.current = {
      stop: () => {
        clearInterval(timer);
        try {
          gain.gain.cancelScheduledValues(ctx.currentTime);
          gain.gain.value = 0;
          osc1.stop();
          osc2.stop();
        } catch {
          // ignore
        }
        ringbackRef.current = null;
      },
    };
  }, []);

  // 준비된 대사 텍스트를 TTS로 합성·재생하고, 재생이 끝나면 다음 청취를 시작한다.
  // t0: 턴 시작 시각, sttMs: STT 소요(없으면 null), tLlm: LLM 완료 시각(오프닝은 t0).
  const playAssistantAudio = useCallback(
    async (text: string, t0: number, sttMs: number | null, tLlm: number) => {
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, scenario: scenarioRef.current?.id }),
      });
      if (!ttsRes.ok) {
        const body = await ttsRes.json().catch(() => null);
        throw new Error(body?.error ?? `TTS 실패 (${ttsRes.status})`);
      }
      const audioData = await ttsRes.blob();
      if (!callActiveRef.current) return;
      const url = URL.createObjectURL(audioData);
      const tTts = performance.now();

      const llmStart = t0 + (sttMs ?? 0);
      setLatencies((prev) => [
        ...prev,
        {
          turn: prev.length + 1,
          stt: sttMs,
          llm: tLlm - llmStart,
          tts: tTts - tLlm,
          total: tTts - t0,
        },
      ]);

      ringbackRef.current?.stop(); // 연결음 정지 후 대사 재생
      const audioEl = audioRef.current;
      if (!audioEl) {
        if (callActiveRef.current) startListeningRef.current();
        return;
      }
      audioEl.src = url;
      setStatus("speaking");
      audioEl.onended = () => {
        URL.revokeObjectURL(url);
        if (callActiveRef.current) startListeningRef.current();
      };
      await audioEl.play().catch(() => {
        if (callActiveRef.current) startListeningRef.current();
      });
    },
    [],
  );

  // LLM으로 응답을 생성한 뒤 재생한다. t0: 턴 시작, sttMs: STT 소요.
  const assistantRespond = useCallback(
    async (history: Message[], t0: number, sttMs: number | null) => {
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, scenario: scenarioRef.current?.id }),
      });
      if (!chatRes.ok) {
        const body = await chatRes.json().catch(() => null);
        throw new Error(body?.error ?? `LLM 실패 (${chatRes.status})`);
      }
      const { text: assistantText } = (await chatRes.json()) as { text: string };
      if (!callActiveRef.current) return;
      setConversation([...history, { role: "assistant", content: assistantText }]);
      const tLlm = performance.now();
      await playAssistantAudio(assistantText, t0, sttMs, tLlm);
    },
    [setConversation, playAssistantAudio],
  );

  // 사용자 발화 오디오 한 턴 처리: STT → (내용 있으면) assistantRespond.
  const runUserTurn = useCallback(
    async (audioBlob: Blob) => {
      if (!callActiveRef.current) return;
      setStatus("processing");
      const t0 = performance.now();
      try {
        const fd = new FormData();
        fd.append("audio", audioBlob, "speech.webm");
        const sttRes = await fetch("/api/stt", { method: "POST", body: fd });
        if (!sttRes.ok) {
          const body = await sttRes.json().catch(() => null);
          throw new Error(body?.error ?? `STT 실패 (${sttRes.status})`);
        }
        const { text: userText } = (await sttRes.json()) as { text: string };
        if (!callActiveRef.current) return;
        const sttMs = performance.now() - t0;

        // 무음/빈 인식이면 응답 없이 다시 청취
        if (!userText.trim()) {
          startListeningRef.current();
          return;
        }

        const history: Message[] = [
          ...messagesRef.current,
          { role: "user", content: userText },
        ];
        setConversation(history);
        await assistantRespond(history, t0, sttMs);
      } catch (err) {
        failCall(err instanceof Error ? err.message : "알 수 없는 오류");
      }
    },
    [assistantRespond, failCall, setConversation],
  );

  // 무음 감지(VAD) 루프. 발화 후 침묵이 이어지면 녹음을 멈춰 턴을 종료한다.
  const startVad = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    let speechMs = 0;
    let silenceMs = 0;
    let elapsed = 0;
    let hasSpoken = false;

    vadTimerRef.current = window.setInterval(() => {
      if (!callActiveRef.current) {
        if (vadTimerRef.current !== null) clearInterval(vadTimerRef.current);
        vadTimerRef.current = null;
        return;
      }
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      elapsed += VAD_INTERVAL_MS;
      if (rms > VAD_RMS_THRESHOLD) {
        speechMs += VAD_INTERVAL_MS;
        silenceMs = 0;
      } else {
        silenceMs += VAD_INTERVAL_MS;
      }
      if (speechMs >= VAD_MIN_SPEECH_MS) hasSpoken = true;

      const silenceEnd = hasSpoken && silenceMs >= VAD_SILENCE_MS;
      const maxEnd = elapsed >= VAD_MAX_UTTERANCE_MS;
      if (!silenceEnd && !maxEnd) return;

      if (vadTimerRef.current !== null) clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;

      // 30초 동안 발화가 전혀 없으면 STT로 보내지 않고 다시 청취
      if (maxEnd && !hasSpoken) {
        const rec = recorderRef.current;
        if (rec) {
          rec.onstop = null;
          try {
            if (rec.state !== "inactive") rec.stop();
          } catch {
            // ignore
          }
        }
        recorderRef.current = null;
        if (callActiveRef.current) startListeningRef.current();
        return;
      }

      recorderRef.current?.stop(); // → onstop → runUserTurn
    }, VAD_INTERVAL_MS);
  }, []);

  // 기존 스트림에 새 MediaRecorder를 만들어 청취를 시작한다.
  const startListening = useCallback(() => {
    const stream = streamRef.current;
    if (!callActiveRef.current || !stream) return;
    setStatus("listening");
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (!callActiveRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mimeType || "audio/webm" });
      void runUserTurn(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    startVad();
  }, [runUserTurn, startVad]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  // 통화 시작: 시나리오 랜덤 배정 → 마이크 확보 → 오디오 분석 셋업 → 오프닝 대사 재생.
  const startCall = useCallback(async () => {
    setError(null);
    setConversation([]);
    setLatencies([]);
    const picked = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
    scenarioRef.current = picked;
    setScenario(picked);
    setStatus("connecting");
    callActiveRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!callActiveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      // 연결음 즉시 재생 → 오프닝 음성 준비되면 멈추고 재생
      startRingback(ctx);

      // 오프닝: 사기꾼이 먼저 말한다. 고정 대사라 LLM 없이 TTS만 태운다.
      const t0 = performance.now();
      setConversation([{ role: "assistant", content: picked.opening }]);
      await playAssistantAudio(picked.opening, t0, null, t0);
    } catch (err) {
      if (err instanceof DOMException) {
        failCall("마이크 권한이 필요합니다.");
      } else {
        failCall(err instanceof Error ? err.message : "통화를 시작할 수 없습니다.");
      }
    }
  }, [startRingback, playAssistantAudio, failCall, setConversation]);

  const reset = useCallback(() => {
    teardown();
    setConversation([]);
    setLatencies([]);
    setError(null);
    setStatus("idle");
  }, [teardown, setConversation]);

  // 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      callActiveRef.current = false;
      if (vadTimerRef.current !== null) clearInterval(vadTimerRef.current);
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const inCall = status !== "idle";
  const statusLine =
    status === "connecting"
      ? "연결 중…"
      : status === "speaking"
        ? "상대방이 말하는 중…"
        : status === "listening"
          ? "듣는 중 · 말이 끝나면 잠시 기다리세요"
          : status === "processing"
            ? "처리 중…"
            : "통화 대기 중";

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-neutral-900 px-4 py-8 text-neutral-100">
      <header className="text-center">
        <h1 className="text-lg font-semibold">보이스백신 · 음성 대화 PoC</h1>
        <p className="text-xs text-neutral-400">
          연속 통화형 STT → LLM → TTS 음성 대화 (데스크톱 데모)
        </p>
      </header>

      {/* 폰 프레임 목업 */}
      <div className="relative h-[760px] w-[380px] rounded-[3rem] border-[10px] border-neutral-700 bg-black shadow-2xl">
        <div className="absolute left-1/2 top-0 z-10 h-6 w-40 -translate-x-1/2 rounded-b-2xl bg-neutral-700" />
        <div className="flex h-full flex-col overflow-hidden rounded-[2.2rem] bg-neutral-950">
          {/* 통화 화면 헤더 */}
          <div className="border-b border-neutral-800 px-5 pb-3 pt-8 text-center">
            <div className="text-sm text-neutral-400">
              {inCall ? "통화 중" : "수신 전화"}
            </div>
            <div className="text-lg font-semibold">
              {scenario ? scenario.caller.name : "모의 훈련 대기"}
            </div>
            <div className="text-xs text-neutral-500">
              {scenario ? scenario.caller.number : "발신자는 통화 시작 시 랜덤 배정"}
            </div>
            {scenario && (
              <div className="mt-1 inline-block rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">
                {scenario.label}
              </div>
            )}
            <div className="mt-2 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-300">
              ⚠️ 훈련용 모의 시뮬레이션입니다. 실제 전화가 아닙니다.
            </div>
          </div>

          {/* 대화 로그 */}
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="mt-10 text-center text-sm text-neutral-500">
                아래 &ldquo;통화 시작&rdquo; 버튼을 눌러 모의 통화를 시작하세요.
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

          {/* 통화 컨트롤 */}
          <div className="border-t border-neutral-800 px-5 py-5">
            <p className="mb-2 text-center text-xs text-neutral-400">{statusLine}</p>
            <button
              onClick={inCall ? endCall : () => void startCall()}
              className={
                "flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold transition " +
                (inCall
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "bg-emerald-600 text-white hover:bg-emerald-500")
              }
            >
              {inCall ? "통화 종료" : "통화 시작"}
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
                  <td className="py-1 text-right">{l.stt === null ? "—" : round(l.stt)}</td>
                  <td className="py-1 text-right">{round(l.llm)}</td>
                  <td className="py-1 text-right">{round(l.tts)}</td>
                  <td className="py-1 text-right font-semibold">{round(l.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-neutral-500">
          합계 = 턴 시작 → TTS 재생 준비 완료까지. 목표 ≤ 4000ms, 허용 ≤ 7000ms. (오프닝 턴은 STT 없음)
        </p>
      </div>
    </main>
  );
}
