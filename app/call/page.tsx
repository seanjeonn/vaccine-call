"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { randomScenario, type Scenario } from "@/lib/scenarios";
import { openingResponseInstructions } from "@/lib/realtime-session";
import {
  applyTelephoneLine,
  buildTelephoneChain,
  TELEPHONE_LINE_ENABLED,
  type TelephoneChain,
  type TelephoneLine,
} from "@/lib/telephone-audio";
import { resolvePipeline, type VoicePipeline } from "@/lib/voice-pipeline";
import { createVoicePlayback, type VoicePlayback } from "@/lib/tts-playback";
import type { TrainingReport } from "@/lib/report";
import TrainingReportView from "@/components/training-report";
import InterventionScreen, { type Interruption } from "@/components/intervention-screen";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
// Realtime 대화 항목. 도착 순서(= 실제 대화 순서)를 item_id 단위로 붙잡아 둔다.
// 사용자 발화의 전사는 사기꾼 응답이 시작된 뒤에 완료되는 것이 보통이라, 완료 순서대로
// 쌓으면 대화가 뒤집힌다. 리포트의 턴 인용(turnIndex)이 어긋나지 않으려면 순서가 중요하다.
type Entry = { id: string; role: Role; content: string };
type Status = "idle" | "connecting" | "speaking" | "listening";
// 리포트는 통화 상태와 별개로 흐른다. (통화 종료 후 idle 상태에서만 표시)
type ReportPhase = "none" | "loading" | "ready" | "error";

// 데이터 채널로 오는 서버 이벤트 중 이 화면이 쓰는 필드만 추린 형태.
type ServerEvent = {
  type?: string;
  item?: { id?: string; type?: string; role?: string };
  item_id?: string;
  transcript?: string;
  text?: string;
  delta?: string;
  error?: { code?: string; message?: string };
};

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);

  const [reportPhase, setReportPhase] = useState<ReportPhase>("none");
  const [report, setReport] = useState<TrainingReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  // 부모로 로그인한 경우에만 서버가 리포트를 저장하고 id를 돌려준다.
  const [reportShared, setReportShared] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);

  // 훈련 중 개입(F1-4). 값이 있으면 통화를 멈추고 정지 화면을 띄운다.
  const [interruption, setInterruption] = useState<Interruption | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 전화선 체인에 넣을 원본 스트림을 붙여두는 곳. 소리는 audioRef가 낸다.
  const rawAudioRef = useRef<HTMLAudioElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null); // 연결음 + 전화선 체인
  const callActiveRef = useRef(false);
  const entriesRef = useRef<Entry[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const ringbackRef = useRef<{ stop: () => void } | null>(null);
  const telephoneRef = useRef<TelephoneLine | null>(null);

  // 목소리를 어디서 만들지. 통화 시작 시점에 정해지고 통화 중에는 바뀌지 않는다.
  const pipelineRef = useRef<VoicePipeline>("realtime");
  const playbackRef = useRef<VoicePlayback | null>(null);
  const chainRef = useRef<TelephoneChain | null>(null);
  // 진행 중인 응답이 없을 때 response.cancel을 보내면 서버가 error를 던진다.
  const responseActiveRef = useRef(false);
  // 끼어들기로 자막을 줄일 때 어느 항목을 줄일지.
  const speakingItemRef = useRef<string | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // 대화 항목을 화면·리포트용 Message[]로 접는다. 전사가 아직 안 온 항목은 비운 채 두고
  // 여기서 걸러낸다. (통화를 끊는 순간 전사 중이던 발화가 빠지는 것은 기존 동작과 같다)
  const syncTranscript = useCallback(() => {
    const next = entriesRef.current
      .map((e) => ({ role: e.role, content: e.content.trim() }))
      .filter((m) => m.content.length > 0);
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const upsertEntry = useCallback((id: string, role: Role) => {
    if (entriesRef.current.some((e) => e.id === id)) return;
    entriesRef.current.push({ id, role, content: "" });
  }, []);

  // 항목에 전사를 채운다. 항목 생성 이벤트보다 전사가 먼저 와도 대사를 잃지 않는다.
  const writeEntry = useCallback(
    (id: string, role: Role, text: string, mode: "set" | "append") => {
      const found = entriesRef.current.find((e) => e.id === id);
      if (!found) {
        entriesRef.current.push({ id, role, content: text });
        return;
      }
      found.content = mode === "append" ? found.content + text : text;
    },
    [],
  );

  // 진행 중인 리포트 요청을 취소하고 리포트 화면을 걷어낸다. (새 통화·초기화 공통)
  const clearReport = useCallback(() => {
    reportAbortRef.current?.abort();
    reportAbortRef.current = null;
    setReportPhase("none");
    setReport(null);
    setReportError(null);
    setReportShared(false);
    setInterruption(null);
  }, []);

  // 통화 종료 후 대화 기록을 분석해 훈련 리포트를 만든다.
  const generateReport = useCallback(
    async (transcript: Message[], scenarioUsed: Scenario | null) => {
      // 사용자가 한마디도 하지 않은 통화는 분석할 것이 없다. (LLM 호출 생략)
      if (!transcript.some((m) => m.role === "user")) {
        setReport(null);
        setReportError(null);
        setReportShared(false);
        setReportPhase("ready");
        return;
      }

      const controller = new AbortController();
      reportAbortRef.current = controller;
      setReport(null);
      setReportError(null);
      setReportShared(false);
      setReportPhase("loading");

      try {
        const res = await fetch("/api/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: transcript, scenario: scenarioUsed }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error ?? "리포트를 만들지 못했습니다.");
        setReport(data.report as TrainingReport);
        setReportShared(Boolean(data.reportId));
        setReportPhase("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setReportError(err instanceof Error ? err.message : "리포트를 만들지 못했습니다.");
        setReportPhase("error");
      } finally {
        if (reportAbortRef.current === controller) reportAbortRef.current = null;
      }
    },
    [],
  );

  // 통화 관련 리소스를 모두 해제한다. (통화 종료·오류 공통)
  const teardown = useCallback(() => {
    // 연결을 끊기 전에 내려야 onclose·connectionstatechange 핸들러가 endCall을 다시 부르지 않는다.
    callActiveRef.current = false;
    ringbackRef.current?.stop();
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    if (rawAudioRef.current) {
      rawAudioRef.current.pause();
      rawAudioRef.current.srcObject = null;
    }
    // 오디오 컨텍스트를 닫기 전에 체인을 끊는다.
    playbackRef.current?.dispose();
    playbackRef.current = null;
    telephoneRef.current?.stop();
    telephoneRef.current = null;
    chainRef.current?.stop();
    chainRef.current = null;
    responseActiveRef.current = false;
    speakingItemRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // 시나리오는 남겨둔다. 통화 종료 후 리포트 화면이 어떤 훈련이었는지 표시해야 한다.
  }, []);

  const endCall = useCallback(() => {
    const transcript = messagesRef.current;
    const scenarioUsed = scenarioRef.current;
    teardown();
    setStatus("idle");
    void generateReport(transcript, scenarioUsed);
  }, [teardown, generateReport]);

  const failCall = useCallback(
    (message: string) => {
      console.error(message);
      // 이미 끝난 통화(종료·개입)에서 뒤늦게 도착한 실패가 정지·리포트 화면을 덮어쓰지 않게 한다.
      if (!callActiveRef.current) return;
      setError(message);
      teardown();
      scenarioRef.current = null;
      setScenario(null);
      setStatus("idle");
    },
    [teardown],
  );

  // 위험 발화가 확인되면 통화를 즉시 끊고 정지 화면을 띄운다 (F1-4).
  // 리포트는 여기서 미리 돌려둔다. 사용자가 정지 화면을 읽는 동안 분석이 끝난다.
  const interruptCall = useCallback(
    (verdict: Interruption) => {
      // 이미 끝난 통화의 뒤늦은 판정은 버린다. (리포트가 두 번 생성되는 것을 막는다)
      if (!callActiveRef.current) return;
      const transcript = messagesRef.current;
      const scenarioUsed = scenarioRef.current;
      teardown();
      setStatus("idle");
      setInterruption(verdict);
      void generateReport(transcript, scenarioUsed);
    },
    [teardown, generateReport],
  );

  // 사용자 발화 한 턴이 결정적 위험인지 판정한다. 사기꾼 응답과 병렬로 돈다.
  // 판정 실패는 훈련을 방해하면 안 되므로 전부 조용히 삼킨다.
  const checkGuard = useCallback(
    async (utterance: string, itemId: string) => {
      try {
        // 이 발화 "직전"의 사기꾼 대사를 찾는다. 판정 시점에는 다음 응답이 이미
        // 흐르고 있을 수 있어, 항목 순서를 기준으로 앞쪽만 본다.
        const at = entriesRef.current.findIndex((e) => e.id === itemId);
        const before = at === -1 ? entriesRef.current : entriesRef.current.slice(0, at);
        const lastAssistant = [...before]
          .reverse()
          .find((e) => e.role === "assistant")?.content;
        const res = await fetch("/api/guard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: utterance,
            lastAssistant,
            scenario: scenarioRef.current,
          }),
        });
        if (!res.ok) return;
        const verdict = (await res.json()) as Interruption & { intervene: boolean };
        if (!verdict.intervene) return;
        interruptCall({
          tag: verdict.tag,
          quote: verdict.quote,
          consequence: verdict.consequence,
        });
      } catch (err) {
        console.error("[guard] 판정 실패", err);
      }
    },
    [interruptCall],
  );

  // 통화 연결음(ringback)을 오실레이터로 합성해 즉시 울린다. 세션 발급·연결 대기 체감을 줄인다.
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
    // 0.5초 간격 울림/침묵 반복 (짧은 대기에도 끊김 없이 자연스러운 연결음)
    let on = false;
    const ring = () => {
      on = !on;
      gain.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, 0.02);
    };
    ring();
    const timer = window.setInterval(ring, 500);
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

  // 사기꾼이 말하기 시작하는 순간. 연결음을 끊고 통화 화면으로 넘긴다.
  const startSpeaking = useCallback(() => {
    ringbackRef.current?.stop();
    if (callActiveRef.current) setStatus("speaking");
  }, []);

  // 끼어들기. realtime 경로에서는 서버가 응답 취소와 재생 절단을 모두 해주지만,
  // 텍스트 출력에서는 서버에 오디오 버퍼가 없어 우리가 끊어야 한다.
  //
  // 자막도 함께 줄인다. 텍스트는 소리보다 먼저 도착하므로, 그냥 두면 사기범이 실제로
  // 말한 적 없는 문장이 화면과 저장된 대화에 남는다. 리포트의 인용과 guard가 그 문자열을
  // 읽기 때문에 이건 표시 문제가 아니다.
  const bargeIn = useCallback(() => {
    if (pipelineRef.current !== "typecast") return;

    if (responseActiveRef.current) {
      dcRef.current?.send(JSON.stringify({ type: "response.cancel" }));
      responseActiveRef.current = false;
    }

    const playback = playbackRef.current;
    const itemId = speakingItemRef.current;
    if (playback && itemId) {
      const spoken = playback.playedChars();
      const entry = entriesRef.current.find((e) => e.id === itemId);
      if (entry && entry.content.length > spoken) {
        entry.content = entry.content.slice(0, spoken).trimEnd();
        syncTranscript();
      }
    }
    playback?.cancel();
    speakingItemRef.current = null;
  }, [syncTranscript]);

  // 데이터 채널로 오는 서버 이벤트를 화면 상태로 옮긴다.
  // realtime 경로에서 끼어들기는 서버 VAD가 처리한다. 사용자가 말을 시작하면 진행 중이던
  // 응답이 서버에서 취소·절단되고, 잘린 자막은 transcript.done이 최종본으로 덮어 바로잡는다.
  const handleServerEvent = useCallback(
    (raw: string) => {
      let ev: ServerEvent;
      try {
        ev = JSON.parse(raw) as ServerEvent;
      } catch {
        return;
      }

      switch (ev.type) {
        // 항목 생성 순서가 곧 대화 순서다. 내용은 비운 채 자리만 잡아둔다.
        // (created는 구버전 이벤트명. 어느 쪽이 와도 순서를 놓치지 않게 함께 받는다)
        case "conversation.item.added":
        case "conversation.item.created": {
          const item = ev.item;
          const role = item?.role;
          if (!item?.id || (role !== "user" && role !== "assistant")) break;
          upsertEntry(item.id, role);
          break;
        }
        case "conversation.item.input_audio_transcription.completed": {
          if (!ev.item_id) break;
          const text = (ev.transcript ?? "").trim();
          writeEntry(ev.item_id, "user", text, "set");
          syncTranscript();
          if (text) void checkGuard(text, ev.item_id);
          break;
        }
        case "response.output_audio_transcript.delta": {
          if (!ev.item_id || !ev.delta) break;
          // 목소리 시작 신호는 output_audio_buffer.started가 정확하지만, 그 이벤트가 오지
          // 않는 경우에도 연결음이 계속 울지 않도록 첫 자막에서도 같은 처리를 해둔다.
          startSpeaking();
          writeEntry(ev.item_id, "assistant", ev.delta, "append");
          syncTranscript();
          break;
        }
        case "response.output_audio_transcript.done": {
          if (!ev.item_id) break;
          writeEntry(ev.item_id, "assistant", ev.transcript ?? "", "set");
          syncTranscript();
          break;
        }
        // 텍스트 출력 경로. 자막은 여기서 채우고, 같은 델타를 재생 큐로 흘린다.
        // 연결음은 여기서 끊지 않는다 — 텍스트는 소리보다 한참 먼저 온다.
        case "response.output_text.delta": {
          if (!ev.item_id || !ev.delta) break;
          speakingItemRef.current = ev.item_id;
          writeEntry(ev.item_id, "assistant", ev.delta, "append");
          syncTranscript();
          playbackRef.current?.push(ev.delta);
          break;
        }
        case "response.output_text.done": {
          if (!ev.item_id) break;
          writeEntry(ev.item_id, "assistant", ev.text ?? "", "set");
          syncTranscript();
          playbackRef.current?.end();
          break;
        }
        // 사기꾼 목소리가 실제로 나오기 시작하는 순간. 연결음은 여기서 끊는다.
        // 텍스트 출력에서는 이 이벤트가 오지 않으므로 재생 큐가 같은 일을 한다.
        case "output_audio_buffer.started": {
          startSpeaking();
          break;
        }
        case "response.created": {
          responseActiveRef.current = true;
          // 조각 번호와 재생 차례를 되돌린다. 응답마다 0번부터 다시 세야 순서가 맞다.
          playbackRef.current?.begin();
          break;
        }
        // 사용자가 말을 시작했다. 사기꾼이 말하는 도중이면 끼어들기다.
        case "input_audio_buffer.speech_started": {
          bargeIn();
          if (callActiveRef.current) setStatus("listening");
          break;
        }
        // 응답이 끝났거나 재생이 멈췄다.
        case "response.done": {
          responseActiveRef.current = false;
          // 텍스트 출력에서는 생성이 끝나도 소리는 아직 남아 있다. 상태는 재생 큐가 비면
          // 그때 되돌린다. 여기서 되돌리면 사기꾼이 말하는 중에 "듣는 중"으로 바뀐다.
          if (pipelineRef.current === "typecast") break;
          if (callActiveRef.current) setStatus("listening");
          break;
        }
        case "output_audio_buffer.stopped":
        case "output_audio_buffer.cleared": {
          if (callActiveRef.current) setStatus("listening");
          break;
        }
        case "error": {
          // 취소가 서버에 닿기 전에 응답이 스스로 끝나면 이 코드가 온다. 플래그로는 못 막는
          // 경합이고, 애초에 원하던 결과(진행 중인 응답 없음)라 조용히 넘긴다.
          if (ev.error?.code === "response_cancel_not_active") break;
          console.error("[realtime]", ev.error);
          break;
        }
      }
    },
    [upsertEntry, writeEntry, syncTranscript, checkGuard, startSpeaking, bargeIn],
  );

  // 통화 시작: 시나리오 배정 → 마이크 확보 → Realtime 세션 발급 → WebRTC 연결 → 오프닝.
  const startCall = useCallback(async () => {
    setError(null);
    clearReport();
    entriesRef.current = [];
    syncTranscript();
    setStatus("connecting");
    callActiveRef.current = true;
    // 맞춤 시나리오 생성(F1-1)은 마이크 확보와 병렬로 띄우고 연결음이 우는 동안 기다린다.
    // 라우트가 실패를 삼키고 정적 시나리오를 주지만, 네트워크가 끊긴 경우는 여기서 받는다.
    const scenarioPromise = fetch("/api/scenario", { method: "POST" })
      .then((res) => (res.ok ? (res.json() as Promise<Scenario>) : randomScenario()))
      .catch(() => randomScenario());
    try {
      // 사기꾼이 말하는 동안에도 마이크는 계속 열려 있다(끼어들기). 스피커로 듣는 데스크톱에서
      // 자기 목소리가 되돌아 들어가지 않도록 에코 제거를 명시한다.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
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
      audioCtxRef.current = ctx;

      // 연결음 즉시 재생 → 사기꾼의 첫 목소리가 나올 때 멈춘다.
      startRingback(ctx);

      // 시나리오 생성 대기. 연결음이 이 시간을 가린다.
      const picked = await scenarioPromise;
      if (!callActiveRef.current) return;
      scenarioRef.current = picked;
      setScenario(picked);

      // 목소리를 어디서 만들지는 통화마다 한 번만 정한다. URL 쿼리가 최우선이라
      // 데모 중에도 /call?pipeline=realtime 으로 즉시 되돌릴 수 있다.
      const pipeline = resolvePipeline(new URLSearchParams(window.location.search));
      pipelineRef.current = pipeline;

      // 외부 TTS 경로는 원격 오디오 트랙이 오지 않는다. 재생 경로를 우리가 세운다.
      // 반드시 MediaStreamDestination → <audio>로 끝내야 한다. ctx.destination으로
      // 직결하면 브라우저 AEC의 참조 신호에서 빠져, 사기꾼 목소리가 마이크로 되돌아가고
      // 서버 VAD가 그것을 사용자 발화로 오인해 통화가 스스로 끊긴다.
      if (pipeline === "typecast") {
        const el = audioRef.current;
        const sink = ctx.createMediaStreamDestination();
        let entry: AudioNode = sink;
        if (TELEPHONE_LINE_ENABLED) {
          const chain = buildTelephoneChain(ctx);
          chain.output.connect(sink);
          chainRef.current = chain;
          entry = chain.input;
        }
        if (el) {
          el.srcObject = sink.stream;
          el.play().catch(() => {});
        }
        playbackRef.current = createVoicePlayback({
          ctx,
          destination: entry,
          scenarioId: picked.id,
          onFirstAudio: startSpeaking,
          onDrain: () => {
            if (callActiveRef.current) setStatus("listening");
          },
          onError: (err) => console.error("[voice]", err),
        });
      }

      // 임시 키 발급. 시나리오 프롬프트·목소리는 서버가 세션에 심는다.
      const keyRes = await fetch("/api/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: picked, pipeline }),
      });
      const keyBody = (await keyRes.json().catch(() => null)) as {
        value?: string;
        error?: string;
      } | null;
      if (!keyRes.ok || !keyBody?.value) {
        throw new Error(keyBody?.error ?? `통화 세션 발급 실패 (${keyRes.status})`);
      }
      if (!callActiveRef.current) return;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.addTrack(stream.getAudioTracks()[0], stream);
      pc.ontrack = (e) => {
        // 텍스트 출력에서는 원격 트랙이 오지 않는다. 와도 우리 재생 경로를 덮으면 안 된다.
        if (pipelineRef.current === "typecast") return;
        const el = audioRef.current;
        if (!el) return;
        // 전화선 체인을 통과시켜 재생한다. 필터를 걸어도 재생은 <audio>가 계속 맡아야
        // 브라우저 AEC가 이 소리를 참조 신호로 잡는다. (직접 destination으로 보내면
        // 사기꾼 목소리가 마이크로 되돌아가 서버 VAD가 사용자 발화로 오인한다)
        const ctx = audioCtxRef.current;
        const raw = rawAudioRef.current;
        if (TELEPHONE_LINE_ENABLED && ctx && raw) {
          // 크롬은 원격 스트림이 미디어 엘리먼트에 붙어 있어야 오디오를 실제로 흘려보낸다.
          // 붙이지 않으면 createMediaStreamSource가 무음만 낸다. 들리는 소리는 필터를 통과한
          // 쪽이어야 하므로 원본은 음소거로 붙여만 둔다.
          raw.muted = true; // 리액트가 muted 속성을 놓쳐도 원본이 새어나오지 않게 한다
          raw.srcObject = e.streams[0];
          raw.play().catch(() => {});
          telephoneRef.current?.stop();
          telephoneRef.current = applyTelephoneLine(ctx, e.streams[0]);
          el.srcObject = telephoneRef.current.stream;
        } else {
          el.srcObject = e.streams[0];
        }
        el.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        // 통화 도중 연결이 끊기면 여기까지의 대화로 정상 종료한다. (리포트는 그대로 나온다)
        if (callActiveRef.current && pc.connectionState === "failed") endCall();
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => handleServerEvent(e.data as string);
      dc.onclose = () => {
        if (callActiveRef.current) endCall();
      };
      dc.onopen = () => {
        // 사기꾼이 먼저 말한다. 오프닝은 이 통화의 고정 대사라 그대로 읽히고,
        // 응답 항목으로 대화에 남아 이어지는 대사가 맥락을 잃지 않는다.
        dc.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: openingResponseInstructions(picked),
            },
          }),
        );
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${keyBody.value}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        // 응답 본문에 원인(쿼터·권한 등)이 담겨 온다. 화면에는 짧게, 콘솔에는 그대로 남긴다.
        console.error("[realtime] 연결 실패", sdpRes.status, await sdpRes.text().catch(() => ""));
        throw new Error(`통화 연결 실패 (${sdpRes.status})`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
    } catch (err) {
      // WebRTC 쪽 실패도 DOMException으로 오므로 마이크 거부는 이름으로 구분한다.
      const micDenied =
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "NotFoundError");
      if (micDenied) {
        failCall("마이크 권한이 필요합니다.");
      } else {
        failCall(err instanceof Error ? err.message : "통화를 시작할 수 없습니다.");
      }
    }
  }, [
    startRingback,
    startSpeaking,
    handleServerEvent,
    syncTranscript,
    endCall,
    failCall,
    clearReport,
  ]);

  const reset = useCallback(() => {
    teardown();
    clearReport();
    scenarioRef.current = null;
    setScenario(null);
    entriesRef.current = [];
    syncTranscript();
    setError(null);
    setStatus("idle");
  }, [teardown, syncTranscript, clearReport]);

  // 언마운트 시 리소스 정리
  useEffect(() => {
    return () => {
      callActiveRef.current = false;
      pcRef.current?.close();
      audioCtxRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const inCall = status !== "idle";
  // 통화가 끝나고 리포트 흐름이 살아 있는 동안은 "다시 훈련하기"로 전환한다.
  const showingReport = !inCall && reportPhase !== "none";
  const statusLine = interruption
    ? "훈련을 멈췄어요"
    : showingReport
    ? reportPhase === "loading"
      ? "통화 종료 · 분석 중"
      : "훈련이 끝났어요"
    : status === "connecting"
      ? "연결 중…"
      : status === "speaking"
        ? "상대방이 말하는 중… · 끼어들어도 됩니다"
        : status === "listening"
          ? "듣는 중 · 편하게 말씀하세요"
          : "통화 대기 중";

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 bg-neutral-900 px-4 py-8 text-neutral-100">
      <header className="text-center">
        <h1 className="text-lg font-semibold">백신콜 모의 훈련</h1>
        <p className="text-xs text-neutral-400">
          사기 전화를 미리 겪어보는 훈련입니다. 실제 전화가 아닙니다.
        </p>
      </header>

      {/* 폰 프레임 목업 */}
      <div className="relative h-[760px] w-[380px] rounded-[3rem] border-[10px] border-neutral-700 bg-black shadow-2xl">
        <div className="absolute left-1/2 top-0 z-10 h-6 w-40 -translate-x-1/2 rounded-b-2xl bg-neutral-700" />
        <div className="flex h-full flex-col overflow-hidden rounded-[2.2rem] bg-neutral-950">
          {/* 통화 화면 헤더 */}
          <div className="border-b border-neutral-800 px-5 pb-3 pt-8 text-center">
            <div className="text-sm text-neutral-400">
              {inCall ? "통화 중" : interruption ? "통화 중단됨" : "수신 전화"}
            </div>
            <div className="text-lg font-semibold">
              {scenario
                ? scenario.caller.name
                : status === "connecting"
                  ? "전화 거는 중"
                  : "모의 훈련 대기"}
            </div>
            <div className="text-xs text-neutral-500">
              {scenario
                ? scenario.caller.number
                : status === "connecting"
                  ? "발신자 확인 중…"
                  : "발신자는 통화 시작 시 배정됩니다"}
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

          {/* 통화음(연결 중)에는 연결 화면, 개입 시 정지 화면, 통화가 끝나면 리포트, 그 외에는 대화 로그 */}
          {status === "connecting" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
              <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-emerald-600/20">
                <span className="text-4xl">📞</span>
              </div>
              <p className="text-base font-medium text-neutral-200">연결 중…</p>
              <p className="text-xs text-neutral-500">잠시만 기다려 주세요</p>
            </div>
          ) : interruption ? (
            <InterventionScreen interruption={interruption} />
          ) : reportPhase === "loading" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
              <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-blue-600/20">
                <span className="text-4xl">📋</span>
              </div>
              <p className="text-base font-medium text-neutral-200">분석 중…</p>
              <p className="text-xs text-neutral-500">
                AI가 통화 내용을 살펴보고 있어요
              </p>
            </div>
          ) : reportPhase === "ready" && report ? (
            <div className="flex flex-1 flex-col overflow-hidden">
              {reportShared && (
                <p className="bg-emerald-500/15 px-4 py-2 text-center text-[13px] text-emerald-300">
                  이 결과가 자녀분께 전달되었어요.
                </p>
              )}
              <TrainingReportView
                report={report}
                messages={messages}
                scenarioLabel={scenario?.label}
              />
            </div>
          ) : reportPhase === "ready" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <span className="text-4xl">🙂</span>
              <p className="text-base font-medium text-neutral-200">
                대화가 너무 짧아 분석할 수 없어요
              </p>
              <p className="text-xs text-neutral-500">
                다음 훈련에서는 사기꾼과 조금 더 이야기해 보세요.
              </p>
            </div>
          ) : (
          <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {reportPhase === "error" && (
              <div className="rounded-lg bg-red-500/15 px-3 py-2 text-[13px] text-red-300">
                <p>리포트를 만들지 못했어요.</p>
                {reportError && (
                  <p className="mt-1 text-[11px] text-red-400/80">{reportError}</p>
                )}
                <button
                  onClick={() =>
                    void generateReport(messages, scenarioRef.current)
                  }
                  className="mt-2 rounded-md bg-red-500/20 px-2.5 py-1 text-[12px] font-medium text-red-200 hover:bg-red-500/30"
                >
                  다시 시도
                </button>
              </div>
            )}
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
          )}

          {/* 통화 컨트롤 */}
          <div className="border-t border-neutral-800 px-5 py-5">
            <p className="mb-2 text-center text-xs text-neutral-400">{statusLine}</p>
            <button
              onClick={
                inCall
                  ? endCall
                  : interruption
                    ? () => setInterruption(null) // 정지 화면 → 리포트 (리포트는 이미 돌고 있다)
                    : showingReport
                      ? reset
                      : () => void startCall()
              }
              className={
                "flex w-full items-center justify-center gap-2 rounded-full py-4 text-base font-semibold transition " +
                (inCall
                  ? "bg-red-600 text-white hover:bg-red-500"
                  : "bg-emerald-600 text-white hover:bg-emerald-500")
              }
            >
              {inCall
                ? "통화 종료"
                : interruption
                  ? "리포트 보기"
                  : showingReport
                    ? "다시 훈련하기"
                    : "통화 시작"}
            </button>
          </div>
        </div>
      </div>

      {/* 사기꾼 음성(원격 트랙) 재생용 */}
      <audio ref={audioRef} autoPlay className="hidden" />
      <audio ref={rawAudioRef} autoPlay muted className="hidden" />

      {error && (
        <p className="w-full max-w-[520px] rounded bg-red-500/15 px-3 py-2 text-sm text-red-300">
          오류: {error}
        </p>
      )}
    </main>
  );
}
