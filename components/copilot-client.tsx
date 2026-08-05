"use client";

// 실시간 통화 코파일럿 화면(F3). 스피커폰으로 걸려온 의심 전화를 마이크로 들으며
// 사기 각본의 단계와 위험도를 좇고, 지금 할 말과 행동을 큰 글씨로 띄운다.
//
// 훈련 화면(app/call/page.tsx)과 뼈대는 같지만 성격이 다르다. 훈련은 턴을 주고받지만
// 여기서는 통화에 끼어들지 않고 5초씩 잘라 듣기만 한다. 폰 목업도 씌우지 않는다 —
// 이 화면을 볼 때 사용자의 폰이 곧 그 전화기라, 화면 전체를 게이지와 안내에 쓴다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getScenario } from "@/lib/scenarios";
import {
  CHUNK_MS,
  COPILOT_CARDS,
  COPILOT_STAGES,
  SIM_SCRIPT,
  STAGE_LABELS,
  riskLevel,
  stageRank,
  type CopilotAnalysis,
  type CopilotLine,
  type CopilotScamType,
  type CopilotStage,
  type SimLine,
} from "@/lib/copilot";

type Status = "idle" | "connecting" | "listening" | "simulating";
type Mode = "live" | "sim";

type AnalysisResponse = CopilotAnalysis & { alerted: boolean };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 마이크 소리 크기 표본 주기와 발화 판정 임계값. 훈련 화면의 VAD와 같은 값을 쓰되,
// 여기서는 턴을 끊는 데 쓰지 않고 "이 조각에 말소리가 있었나"만 본다.
const RMS_INTERVAL_MS = 50;
const RMS_THRESHOLD = 0.02;

// 이보다 짧게 인식된 조각은 잡음으로 보고 분석에 보내지 않는다.
const MIN_TRANSCRIPT_LENGTH = 4;

const GAUGE_CLASSES = {
  low: "bg-emerald-500",
  medium: "bg-amber-500",
  high: "bg-red-600",
} as const;

const GAUGE_TEXT_CLASSES = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-red-400",
} as const;

const RISK_LABELS = { low: "낮음", medium: "주의", high: "높음" } as const;

export default function CopilotClient() {
  const [status, setStatus] = useState<Status>("idle");
  const [mode, setMode] = useState<Mode>("live");
  const [simDone, setSimDone] = useState(false);
  const [lines, setLines] = useState<CopilotLine[]>([]);
  const [stage, setStage] = useState<CopilotStage>("none");
  const [risk, setRisk] = useState(0);
  const [scamType, setScamType] = useState<CopilotScamType>("unknown");
  const [alerted, setAlerted] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callActiveRef = useRef(false);
  const callIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const chunkTimerRef = useRef<number | null>(null);
  const rmsTimerRef = useRef<number | null>(null);
  const chunkPeakRef = useRef(0);
  // 안내 음성이 나가는 동안에는 녹음을 멈춘다. 그러지 않으면 코파일럿이 제 목소리를 받아적는다.
  const pausedRef = useRef(false);

  const linesRef = useRef<CopilotLine[]>([]);
  const stageRef = useRef<CopilotStage>("none");
  const voiceOnRef = useRef(false);
  // 분석은 한 번에 하나만 돌린다. 그동안 들어온 말은 모아뒀다 다음 호출에 함께 보낸다.
  const analyzingRef = useRef(false);
  const pendingTextRef = useRef("");

  // 상호 재귀(조각 녹음 → 종료 → 다음 조각)의 stale 참조를 피하기 위한 간접 참조.
  const startChunkRef = useRef<() => void>(() => {});

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  const stopRecorder = useCallback(() => {
    if (chunkTimerRef.current !== null) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec) {
      rec.onstop = null; // 다음 조각 자동 시작 방지
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    callActiveRef.current = false;
    pausedRef.current = false;
    stopRecorder();
    if (rmsTimerRef.current !== null) {
      clearInterval(rmsTimerRef.current);
      rmsTimerRef.current = null;
    }
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
  }, [stopRecorder]);

  // 오디오 한 조각을 재생하고 끝날 때까지 기다린다. (훈련 화면과 같은 방식이지만
  // 그쪽을 건드리지 않으려고 여기에 따로 둔다)
  const playBlob = useCallback((blob: Blob) => {
    return new Promise<void>((resolve) => {
      const audioEl = audioRef.current;
      const url = URL.createObjectURL(blob);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve();
      };
      if (!audioEl) {
        finish();
        return;
      }
      audioEl.src = url;
      audioEl.onplay = () => {
        // 재생이 시작된 뒤에만 pause를 종료 신호로 본다. (통화 종료로 멈춘 경우 대기 해제)
        audioEl.onpause = finish;
      };
      audioEl.onended = finish;
      audioEl.play().catch(finish);
    });
  }, []);

  // 단계가 올라갔을 때만 안내를 읽어준다. 스피커폰 옆에서 소리가 나므로 기본은 꺼둔다.
  const speakGuidance = useCallback(
    async (next: CopilotStage) => {
      const card = COPILOT_CARDS[next];
      pausedRef.current = true;
      stopRecorder();
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${card.headline}. ${card.say} ${card.act}`,
            persona: "clerk",
          }),
        });
        if (res.ok) {
          const blob = await res.blob();
          if (callActiveRef.current) await playBlob(blob);
        }
      } catch (err) {
        console.error("[copilot] 안내 음성 실패", err);
      } finally {
        pausedRef.current = false;
        if (callActiveRef.current) startChunkRef.current();
      }
    },
    [playBlob, stopRecorder],
  );

  // 화면 상태를 갱신하고, 단계가 올라갔으면 그 단계를 돌려준다.
  // 안내 음성을 여기서 바로 틀지 않는 것은 체험 모드 때문이다. 체험 모드는 대본 음성과
  // 안내 음성이 같은 스피커를 쓰므로 호출한 쪽이 순서를 정해야 한다.
  const applyAnalysis = useCallback(
    (data: AnalysisResponse, appendLines: boolean): CopilotStage | null => {
      if (appendLines && data.lines.length > 0) {
        const next = [...linesRef.current, ...data.lines];
        linesRef.current = next;
        setLines(next);
      }
      setRisk(data.risk);
      setStage(data.stage);
      setScamType(data.scamType);
      if (data.alerted) setAlerted(true);

      const escalated = stageRank(data.stage) > stageRank(stageRef.current);
      stageRef.current = data.stage;
      if (!escalated) return null;
      // 화면을 못 보고 있을 수 있다. 진동은 스피커폰 옆에서도 조용하다.
      navigator.vibrate?.([200, 100, 200]);
      return data.stage;
    },
    [],
  );

  // 분석 실패는 통화를 방해하면 안 되므로 조용히 삼킨다. 다음 조각에서 다시 판정된다.
  const analyze = useCallback(
    async (
      payload: { newText?: string; newLines?: CopilotLine[] },
      appendLines = true,
    ): Promise<CopilotStage | null> => {
      const callId = callIdRef.current;
      if (!callId) return null;
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ callId, ...payload }),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as AnalysisResponse;
        if (!callActiveRef.current) return null;
        return applyAnalysis(data, appendLines);
      } catch (err) {
        console.error("[copilot] 분석 실패", err);
        return null;
      }
    },
    [applyAnalysis],
  );

  // 분석 요청을 직렬로 흘린다. 도는 동안 들어온 말은 모아뒀다 한 번에 보낸다.
  const drainAnalysis = useCallback(async () => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    try {
      while (callActiveRef.current && pendingTextRef.current.trim()) {
        const text = pendingTextRef.current.trim();
        pendingTextRef.current = "";
        const escalated = await analyze({ newText: text });
        // 안내는 기다리지 않는다. 통화는 계속 흐르므로 다음 조각을 놓치면 안 된다.
        if (escalated && voiceOnRef.current) void speakGuidance(escalated);
      }
    } finally {
      analyzingRef.current = false;
    }
  }, [analyze, speakGuidance]);

  const transcribeChunk = useCallback(
    async (blob: Blob) => {
      try {
        const fd = new FormData();
        fd.append("audio", blob, "chunk.webm");
        const res = await fetch("/api/stt", { method: "POST", body: fd });
        if (!res.ok || !callActiveRef.current) return;
        const { text } = (await res.json()) as { text: string };
        if (text.trim().length < MIN_TRANSCRIPT_LENGTH) return;
        pendingTextRef.current = `${pendingTextRef.current} ${text.trim()}`.trim();
        void drainAnalysis();
      } catch (err) {
        console.error("[copilot] 전사 실패", err);
      }
    },
    [drainAnalysis],
  );

  // 조각마다 MediaRecorder를 새로 만든다. start(timeslice)로 쪼개면 두 번째 조각부터
  // webm 컨테이너 헤더가 없어 STT가 읽지 못한다.
  const startChunk = useCallback(() => {
    const stream = streamRef.current;
    if (!callActiveRef.current || pausedRef.current || !stream) return;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    chunkPeakRef.current = 0;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const hadVoice = chunkPeakRef.current > RMS_THRESHOLD;
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      // 녹음이 네트워크를 기다리지 않도록 다음 조각을 먼저 연다.
      startChunkRef.current();
      // 아무 소리도 없던 조각은 STT에 보내지 않는다. 긴 통화의 비용 밸브다.
      if (hadVoice) void transcribeChunk(blob);
    };

    recorderRef.current = recorder;
    recorder.start();
    chunkTimerRef.current = window.setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, CHUNK_MS);
  }, [transcribeChunk]);

  useEffect(() => {
    startChunkRef.current = startChunk;
  }, [startChunk]);

  const resetState = useCallback(() => {
    linesRef.current = [];
    stageRef.current = "none";
    pendingTextRef.current = "";
    setLines([]);
    setStage("none");
    setRisk(0);
    setScamType("unknown");
    setAlerted(false);
    setSimDone(false);
    setError(null);
  }, []);

  // 통화 세션을 열고 callId를 잡는다. 실전·체험 모드가 같은 파이프라인을 쓴다.
  const openCall = useCallback(async (which: Mode) => {
    const res = await fetch("/api/copilot/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: which }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? "통화를 시작하지 못했습니다.");
    }
    const { callId } = (await res.json()) as { callId: string };
    callIdRef.current = callId;
  }, []);

  const synthesizeSimLine = useCallback(async (line: SimLine) => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        line.speaker === "caller"
          ? { text: line.text, scenario: "institution" }
          : { text: line.text, persona: "victim" },
      ),
    });
    if (!res.ok) throw new Error("TTS 실패");
    return res.blob();
  }, []);

  // 체험 모드(F3 시연). 마이크를 쓰지 않고 대본을 두 목소리로 들려주면서
  // 같은 분석 파이프라인에 밀어 넣는다. 대본이라 화자가 확정되어 STT를 건너뛴다.
  const runSim = useCallback(async () => {
    // 다음 대사는 지금 대사가 나가는 동안 미리 합성한다.
    let upcoming = synthesizeSimLine(SIM_SCRIPT[0]);
    upcoming.catch(() => {}); // 실패는 재생 시점에 받는다. 여기서는 unhandled만 막는다

    for (let i = 0; i < SIM_SCRIPT.length; i++) {
      if (!callActiveRef.current) return;
      const line = SIM_SCRIPT[i];
      const current = upcoming;
      const nextLine = SIM_SCRIPT[i + 1];
      if (nextLine) {
        upcoming = synthesizeSimLine(nextLine);
        upcoming.catch(() => {});
      }

      // 자막은 음성이 나가는 시점에 맞춘다. 분석 응답을 기다리면 한 박자 늦다.
      const next = [...linesRef.current, { speaker: line.speaker, text: line.text }];
      linesRef.current = next;
      setLines(next);

      try {
        const blob = await current;
        if (!callActiveRef.current) return;
        await playBlob(blob);
      } catch (err) {
        console.error("[copilot] 체험 음성 실패", err);
      }
      if (!callActiveRef.current) return;

      const escalated = await analyze(
        { newLines: [{ speaker: line.speaker, text: line.text }] },
        false, // 자막은 위에서 이미 붙였다
      );
      if (!callActiveRef.current) return;
      // 실전과 달리 안내를 끝까지 기다린다. 대본 음성과 스피커가 겹치면 안 된다.
      if (escalated && voiceOnRef.current) await speakGuidance(escalated);
      if (!callActiveRef.current) return;
      await wait(line.pauseMs);
    }

    if (callActiveRef.current) setSimDone(true);
  }, [analyze, playBlob, speakGuidance, synthesizeSimLine]);

  const startSim = useCallback(async () => {
    resetState();
    setMode("sim");
    setStatus("connecting");
    callActiveRef.current = true;
    // 체험 모드에는 옆에서 들을 사기꾼이 없다. 안내 음성이 있어야 시연이 산다.
    setVoiceOn(true);
    voiceOnRef.current = true;

    try {
      await openCall("sim");
      if (!callActiveRef.current) return;
      setStatus("simulating");
      await runSim();
    } catch (err) {
      teardown();
      setStatus("idle");
      setError(err instanceof Error ? err.message : "체험을 시작할 수 없습니다.");
    }
  }, [openCall, resetState, runSim, teardown]);

  const startCall = useCallback(async () => {
    resetState();
    setMode("live");
    setStatus("connecting");
    callActiveRef.current = true;

    try {
      await openCall("live");

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

      // 조각마다 "말소리가 있었나"를 판정하려고 소리 크기만 계속 지켜본다.
      const buf = new Uint8Array(analyser.fftSize);
      rmsTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > chunkPeakRef.current) chunkPeakRef.current = rms;
      }, RMS_INTERVAL_MS);

      setStatus("listening");
      startChunkRef.current();
    } catch (err) {
      teardown();
      setStatus("idle");
      setError(
        err instanceof DOMException
          ? "마이크를 쓸 수 없습니다. 권한을 허용해 주세요."
          : err instanceof Error
            ? err.message
            : "통화 분석을 시작할 수 없습니다.",
      );
    }
  }, [openCall, resetState, teardown]);

  const endCall = useCallback(() => {
    const callId = callIdRef.current;
    teardown();
    setStatus("idle");
    if (callId) {
      void fetch("/api/copilot/call", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId }),
      }).catch(() => {});
    }
  }, [teardown]);

  useEffect(() => {
    return () => {
      callActiveRef.current = false;
      if (chunkTimerRef.current !== null) clearTimeout(chunkTimerRef.current);
      if (rmsTimerRef.current !== null) clearInterval(rmsTimerRef.current);
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const level = riskLevel(risk);
  const card = COPILOT_CARDS[stage];
  const inCall = status !== "idle";
  const recentLines = lines.slice(-3);

  if (!inCall) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
        <header>
          <h1 className="text-3xl font-bold leading-snug">
            의심스러운 전화를
            <br />
            받고 계신가요?
          </h1>
          <p className="mt-3 text-xl leading-relaxed text-neutral-400">
            전화를 <b className="text-neutral-200">스피커폰</b>으로 바꾸고 아래 버튼을
            누르세요. 통화 내용을 들으면서 무엇을 하셔야 하는지 알려드릴게요.
          </p>
        </header>

        {error && (
          <p className="rounded-lg bg-red-500/15 px-4 py-3 text-lg leading-relaxed text-red-300">
            {error}
          </p>
        )}

        <button
          onClick={() => void startCall()}
          className="rounded-full bg-amber-500 py-8 text-center text-3xl font-bold text-neutral-950 transition hover:bg-amber-400"
        >
          통화 분석 시작하기
        </button>

        <p className="text-center text-lg leading-relaxed text-neutral-500">
          분석하는 동안 상대방에게는 아무 소리도 들리지 않습니다.
        </p>

        {/* 실제 사기 전화를 기다릴 수 없으니, 가짜 통화로 기능을 보여주는 입구를 둔다. */}
        <button
          onClick={() => void startSim()}
          className="rounded-2xl border border-neutral-700 px-5 py-4 text-center text-xl font-medium text-neutral-300 transition hover:border-neutral-500"
        >
          체험 모드로 보기
          <span className="mt-1 block text-base font-normal text-neutral-500">
            마이크 없이 가짜 사기 전화를 들려드려요
          </span>
        </button>

        <Link href="/p" className="text-center text-lg text-neutral-400 underline">
          홈으로 돌아가기
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-5 py-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="text-lg font-semibold">
            {status === "connecting"
              ? "준비 중…"
              : mode === "sim"
                ? "가짜 전화를 듣고 있어요"
                : "통화를 듣고 있어요"}
          </span>
        </div>
        <button
          onClick={() => setVoiceOn((v) => !v)}
          className={
            "rounded-full px-3 py-1.5 text-sm font-medium transition " +
            (voiceOn
              ? "bg-neutral-200 text-neutral-900"
              : "border border-neutral-700 text-neutral-400")
          }
        >
          {voiceOn ? "음성 안내 켬" : "음성 안내 끔"}
        </button>
      </header>

      {/* 체험 모드는 실제 전화로 오해받으면 안 된다 (PRD §5 안전장치). */}
      {mode === "sim" && (
        <p className="rounded-lg bg-amber-500/15 px-4 py-2 text-center text-base font-medium text-amber-300">
          ⚠️ 체험 모드입니다. 실제 전화가 아닙니다.
        </p>
      )}

      {/* 위험도 게이지 */}
      <section>
        <div className="flex items-baseline justify-between">
          <span className="text-lg text-neutral-400">
            {scamType === "unknown" ? "위험도" : `${getScenario(scamType).label} 의심`}
          </span>
          <span className={"text-4xl font-bold " + GAUGE_TEXT_CLASSES[level]}>
            {RISK_LABELS[level]}
          </span>
        </div>
        <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-neutral-800">
          <div
            className={"h-full rounded-full transition-all duration-700 " + GAUGE_CLASSES[level]}
            style={{ width: `${Math.max(risk, 3)}%` }}
          />
        </div>
      </section>

      {/* 사기 각본 진행 단계 */}
      <section className="flex gap-1.5">
        {COPILOT_STAGES.map((s) => {
          const reached = stageRank(stage) >= stageRank(s);
          return (
            <div key={s} className="flex-1 text-center">
              <div
                className={
                  "h-1.5 rounded-full " + (reached ? "bg-red-500" : "bg-neutral-800")
                }
              />
              <span
                className={
                  "mt-1 block text-xs " + (reached ? "text-red-400" : "text-neutral-600")
                }
              >
                {STAGE_LABELS[s]}
              </span>
            </div>
          );
        })}
      </section>

      {/* 개입 카드 — 이 화면의 중심 */}
      <section
        className={
          "rounded-2xl border px-5 py-5 " +
          (level === "high"
            ? "border-red-500/50 bg-red-500/10"
            : level === "medium"
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-neutral-800 bg-neutral-900/60")
        }
      >
        <h2 className="text-2xl font-bold leading-snug">{card.headline}</h2>
        <div className="mt-4">
          <p className="text-sm font-semibold text-neutral-400">이렇게 말하세요</p>
          <p className="mt-1 text-xl leading-relaxed">{card.say}</p>
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold text-neutral-400">이렇게 하세요</p>
          <p className="mt-1 text-xl leading-relaxed">{card.act}</p>
        </div>
      </section>

      {alerted && (
        <p className="rounded-lg bg-emerald-500/15 px-4 py-3 text-lg font-medium text-emerald-300">
          자녀분께 알려드렸어요. 곧 연락이 올 거예요.
        </p>
      )}

      {/* 들은 내용 — 제대로 듣고 있다는 것만 보여주면 되므로 최근 몇 줄만 */}
      {recentLines.length > 0 && (
        <section className="space-y-1">
          {recentLines.map((line, i) => (
            <p key={i} className="text-sm leading-relaxed text-neutral-500">
              <span className="text-neutral-600">
                {line.speaker === "caller" ? "상대방" : "나"}:{" "}
              </span>
              {line.text}
            </p>
          ))}
        </section>
      )}

      <div className="mt-auto pt-4">
        {simDone && (
          <p className="mb-3 text-center text-lg leading-relaxed text-neutral-400">
            체험이 끝났어요. 아래 버튼을 눌러 마무리하세요.
          </p>
        )}
        <button
          onClick={endCall}
          className="w-full rounded-full bg-red-600 py-8 text-center text-3xl font-bold text-white transition hover:bg-red-500"
        >
          {mode === "sim" ? "체험 끝내기" : "통화 종료"}
        </button>
      </div>

      <audio ref={audioRef} className="hidden" />
    </main>
  );
}
