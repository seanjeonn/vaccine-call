// 훈련 통화(F1)에서 사기범의 텍스트를 받아 소리로 만들어 재생하는 큐.
//
// Realtime을 텍스트 출력으로 돌리면 서버가 해주던 두 가지를 우리가 해야 한다 —
// 음성 합성과, 끼어들기 때 재생을 끊는 일이다. 이 파일이 그 둘을 맡는다.
//
// 설계에 영향을 준 실측 (docs/planning/tts-provider-spike.md):
//   - Typecast 합성은 첫 오디오까지 ~250ms의 고정 바닥이 있고 20자를 넘으면 평평해진다.
//     (2자 274ms / 21자 487ms / 58자 502ms) 그래서 잘게 쪼개도 얻는 게 얼마 없다.
//   - 다만 첫 조각만은 다르다. LLM의 첫 델타(617ms)와 첫 문장 완성(766ms) 사이 149ms를
//     아낄 수 있어서, 첫 조각은 쉼표에서도 끊는다. 두 번째부터는 문장 단위다.

import type { ScenarioId } from "@/lib/scenarios";
import { TYPECAST_SAMPLE_RATE } from "@/lib/tts-voices";
import { chunkEnd } from "@/lib/tts-chunk";

// 스케줄에 주는 여유. 낮추면 지연이 줄지만 언더런(뚝뚝 끊김) 위험이 커진다.
const JITTER_MS = 90;
// 이만큼 모이기 전에는 재생 노드를 만들지 않는다. 너무 잘게 쪼개면 노드만 늘어난다.
const MIN_BLOCK_SAMPLES = TYPECAST_SAMPLE_RATE / 10; // 100ms
// 동시에 띄워 둘 합성 요청 수. 재생 중인 조각의 다음 것을 미리 만들어 공백을 막는다.
const PREFETCH = 2;

export type VoicePlayback = {
  /** LLM 텍스트 델타. 조각이 완성되면 알아서 합성·재생한다. */
  push(delta: string): void;
  /** 응답 종료. 버퍼에 남은 말을 마저 밀어낸다. */
  end(): void;
  /** 끼어들기. 재생·대기·진행 중 요청을 전부 버린다. */
  cancel(): void;
  /** 실제로 소리가 난 데까지의 글자 수. 잘린 자막을 여기까지로 줄인다. */
  playedChars(): number;
  /** 통화 종료. 되돌릴 수 없다. */
  dispose(): void;
};

type Chunk = { text: string; index: number };

export function createVoicePlayback(opts: {
  ctx: AudioContext;
  /** 전화선 체인의 입력. 여기서 destination으로 직결하면 브라우저 AEC가 이 소리를 놓친다. */
  destination: AudioNode;
  scenarioId: ScenarioId;
  /** 첫 소리가 실제로 재생되는 순간. 연결음을 여기서 끊는다. */
  onFirstAudio: () => void;
  /** 재생할 것이 다 떨어진 순간. 상태를 '듣는 중'으로 되돌린다. */
  onDrain: () => void;
  onError?: (err: Error) => void;
}): VoicePlayback {
  const { ctx, destination, scenarioId, onFirstAudio, onDrain, onError } = opts;

  let buffer = "";
  let chunkIndex = 0;
  let ended = false;
  let disposed = false;
  let firstAudioFired = false;
  let played = 0;

  // 세대 번호. 끼어들기가 나면 올리고, 이전 세대의 응답·재생은 전부 버린다.
  let generation = 0;

  const pending: Chunk[] = [];
  const inFlight = new Map<number, AbortController>();
  const live = new Set<AudioBufferSourceNode>();
  // 다음 소리를 이어 붙일 시각. 조각 사이에 공백이 생기지 않게 한다.
  let nextStartAt = 0;
  let scheduled = 0;

  const fail = (err: unknown) => {
    if (!disposed) onError?.(err instanceof Error ? err : new Error(String(err)));
  };

  const drainIfIdle = () => {
    if (disposed) return;
    if (pending.length || inFlight.size || scheduled) return;
    if (!ended) return;
    onDrain();
  };

  /** 조각 하나를 합성해 도착하는 대로 재생 큐에 올린다. */
  const synthesize = async (chunk: Chunk, mine: number) => {
    const controller = new AbortController();
    inFlight.set(chunk.index, controller);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chunk.text, scenarioId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`음성 합성 실패 (${res.status})`);
      await consume(res.body, chunk, mine);
    } catch (err) {
      if (controller.signal.aborted) return;
      fail(err);
    } finally {
      inFlight.delete(chunk.index);
      if (mine === generation) {
        pump();
        drainIfIdle();
      }
    }
  };

  /**
   * 응답 본문을 읽으며 PCM을 모아 재생한다. 두 가지를 반드시 처리해야 한다 —
   * 첫 44바이트 WAV 헤더(청크 경계에 걸쳐 올 수 있다)와, Int16 샘플을 반으로 쪼개는
   * 홀수 바이트 경계다. 후자를 빠뜨리면 조각마다 지직거린다.
   */
  const consume = async (body: ReadableStream<Uint8Array>, chunk: Chunk, mine: number) => {
    const reader = body.getReader();
    let header = 44;
    let carry: Uint8Array | null = null;
    let block: Int16Array[] = [];
    let blockLength = 0;
    let creditedChars = false;

    const flushBlock = () => {
      if (!blockLength || mine !== generation || disposed) return;
      const merged = new Int16Array(blockLength);
      let at = 0;
      for (const part of block) {
        merged.set(part, at);
        at += part.length;
      }
      block = [];
      blockLength = 0;
      schedule(merged, chunk, mine, () => {
        if (creditedChars) return;
        creditedChars = true;
        played += chunk.text.length;
      });
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.length || mine !== generation || disposed) continue;

      let bytes: Uint8Array = value;
      if (header > 0) {
        const skip = Math.min(header, bytes.length);
        header -= skip;
        bytes = bytes.subarray(skip);
        if (!bytes.length) continue;
      }
      if (carry) {
        const joined = new Uint8Array(carry.length + bytes.length);
        joined.set(carry, 0);
        joined.set(bytes, carry.length);
        bytes = joined;
        carry = null;
      }
      const usable = bytes.length - (bytes.length % 2);
      if (usable < bytes.length) carry = bytes.subarray(usable).slice();
      if (!usable) continue;

      const samples = new Int16Array(usable / 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true);
      block.push(samples);
      blockLength += samples.length;
      if (blockLength >= MIN_BLOCK_SAMPLES) flushBlock();
    }
    flushBlock();
  };

  /** PCM 한 덩이를 이전 소리 뒤에 이어 예약한다. */
  const schedule = (samples: Int16Array, chunk: Chunk, mine: number, onStart: () => void) => {
    if (mine !== generation || disposed || !samples.length) return;

    // 프로바이더의 샘플레이트를 그대로 태그하면 브라우저가 재생 시 알아서 리샘플한다.
    const audio = ctx.createBuffer(1, samples.length, TYPECAST_SAMPLE_RATE);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = audio;
    source.connect(destination);

    const earliest = ctx.currentTime + JITTER_MS / 1000;
    const startAt = Math.max(earliest, nextStartAt);
    nextStartAt = startAt + audio.duration;

    scheduled++;
    live.add(source);
    source.onended = () => {
      live.delete(source);
      scheduled--;
      if (mine === generation) drainIfIdle();
    };
    source.start(startAt);

    onStart();
    if (!firstAudioFired) {
      firstAudioFired = true;
      // 예약 시점이 아니라 실제로 소리가 나기 시작할 때 알린다. 여기서 연결음이 끊긴다.
      window.setTimeout(onFirstAudio, Math.max(0, (startAt - ctx.currentTime) * 1000));
    }
  };

  /** 대기 중인 조각을 선합성 한도까지 띄운다. */
  const pump = () => {
    if (disposed) return;
    const mine = generation;
    while (pending.length && inFlight.size < PREFETCH) {
      const chunk = pending.shift()!;
      void synthesize(chunk, mine);
    }
  };

  /** 버퍼에서 보낼 수 있는 조각을 떼어낸다. */
  const takeChunk = (force: boolean): string | null => {
    const text = buffer.trimStart();
    if (!text) {
      buffer = "";
      return null;
    }
    if (force) {
      buffer = "";
      return text;
    }
    const cut = chunkEnd(text, chunkIndex === 0);
    if (cut < 0) {
      buffer = text;
      return null;
    }
    buffer = text.slice(cut);
    return text.slice(0, cut);
  };

  const emit = (force: boolean) => {
    for (;;) {
      const text = takeChunk(force);
      if (!text) break;
      pending.push({ text, index: chunkIndex++ });
    }
    pump();
  };

  const abortAll = () => {
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
    pending.length = 0;
    for (const source of live) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // 이미 끝난 노드
      }
      source.disconnect();
    }
    live.clear();
    scheduled = 0;
    nextStartAt = 0;
  };

  return {
    push(delta) {
      if (disposed || ended) return;
      buffer += delta;
      emit(false);
    },
    end() {
      if (disposed || ended) return;
      ended = true;
      emit(true);
      drainIfIdle();
    },
    cancel() {
      if (disposed) return;
      // 세대를 올리면 이미 날아오는 중인 응답과 예약된 소리가 전부 무효가 된다.
      generation++;
      abortAll();
      buffer = "";
      chunkIndex = 0;
      ended = false;
      firstAudioFired = true; // 통화 중이므로 연결음은 이미 끊겼다
    },
    playedChars() {
      return played;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      abortAll();
    },
  };
}
