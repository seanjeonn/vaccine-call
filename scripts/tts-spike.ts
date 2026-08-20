// TTS 프로바이더 검증 스파이크 (Phase 0). 앱 코드는 건드리지 않는다.
//
// 훈련 통화(F1)의 목소리를 gpt-realtime에서 외부 TTS로 옮길지 판단하기 위한 측정 도구다.
// 판단 근거가 되는 네 가지를 각각 따로 잰다. 순서가 중요하다 — moderation이 막히면
// 나머지를 잴 이유가 없고, voices/samples는 그다음, latency는 마지막이다.
//
//   moderation  사기범 대사를 프로바이더가 합성해 주는가          (막히면 전면 중단)
//   voices      한국어 voice 후보 목록                            (samples의 입력)
//   samples     후보별 시나리오 대사 합성 → 블라인드 청취용 파일
//   latency     첫 오디오 바이트까지의 지연 (TTFB)
//   baseline    현행 Realtime의 발화 종료 → 첫 소리 지연
//
// baseline은 OPENAI_API_KEY만 있으면 돌아간다. 나머지는 ELEVENLABS_API_KEY /
// TYPECAST_API_KEY가 필요하고, 키가 있는 프로바이더만 자동으로 대상에 들어간다.
//
// 사용법: node --env-file=.env scripts/tts-spike.ts <mode> [--reps 20] [--provider eleven]
//
// 청취는 파일을 직접 듣지 말고 npm run dev 후 /spike/listen 에서 한다. 그 페이지가
// lib/telephone-audio.ts의 실제 체인을 통과시킨다. 협대역으로 깎이기 전 소리를 비교하면
// 프로덕션에서 들릴 소리와 다른 것을 고르게 된다.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { SCENARIOS, type ScenarioId } from "../lib/scenarios.ts";
import { REALTIME_MODEL, buildSessionConfig, openingResponseInstructions } from "../lib/realtime-session.ts";
import { SCRIPTS, VICTIM_TONE, VICTIM_VOICE } from "./victim-scripts.ts";

const OUT_DIR = "spike-out";
// 청취 페이지(/spike/listen)가 바로 읽을 수 있게 public 아래에 쓴다. .gitignore 대상이다.
const SAMPLE_DIR = join("public", "spike");

// eval 하네스와 같은 프레이밍. 서버 VAD가 프로덕션과 같은 조건에서 턴을 끊게 한다.
const BYTES_PER_SEC = 24000 * 2; // 16bit mono
const FRAME_MS = 40;
const FRAME_BYTES = (BYTES_PER_SEC * FRAME_MS) / 1000; // 1920

const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
const TYPECAST_KEY = process.env.TYPECAST_API_KEY;

const ELEVEN_MODEL = "eleven_flash_v2_5";
const TYPECAST_MODEL = "ssfm-v30";

// --- 대사 -----------------------------------------------------------------

// 시나리오마다 고정 오프닝 + 압박 대사 하나. 압박 대사는 배역이 실제로 무엇을 요구하는지
// 드러나는 문장으로 골랐다 — 모더레이션 판정에서 가장 걸리기 쉬운 지점이기도 하다.
const PRESSURE: Record<ScenarioId, string> = {
  institution:
    "지금 이 통화 녹취되고 있습니다. 계좌에 있는 돈, 국가 안전계좌로 전액 이체하셔야 보전됩니다. 지금 은행 가세요.",
  family:
    "엄마 제발… 나 지금 경찰서야, 어떡해. 합의금 오늘 안 넣으면 나 진짜 큰일 나. 그냥 이 계좌로 먼저 좀 보내줘.",
  loan: "고객님, 오늘까지만 가능한 조건이에요. 기존 대출 상환금 먼저 입금해 주시면 바로 저금리로 전환됩니다.",
};

type SpikeLine = { scenario: ScenarioId; kind: "opening" | "pressure"; text: string };

function spikeLines(): SpikeLine[] {
  return SCENARIOS.flatMap((s) => [
    { scenario: s.id, kind: "opening" as const, text: s.opening },
    { scenario: s.id, kind: "pressure" as const, text: PRESSURE[s.id] },
  ]);
}

// --- 프로바이더별 톤 파라미터 ------------------------------------------------

// 시작점일 뿐이다. Phase 0 청취 결과로 조정한다. 근거는 lib/scenarios.ts의 ttsInstructions.
const ELEVEN_SETTINGS: Record<ScenarioId, Record<string, number | boolean>> = {
  // 감정 없는 사무적 수사관 — stability를 올려 표현력을 죽인다.
  institution: { stability: 0.65, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 0.96 },
  // 무너지는 아들 — stability를 내려 흔들림을 허용한다. 낮을수록 한국어 아티팩트 위험이 커진다.
  family: { stability: 0.3, similarity_boost: 0.75, style: 0.55, speed: 1.08 },
  loan: { stability: 0.55, similarity_boost: 0.85, style: 0.3, speed: 1.1 },
};

// Typecast 7종 프리셋에 "당황/다급"이 없다. family는 sad + 빠른 tempo가 최근사다.
const TYPECAST_PROMPT: Record<ScenarioId, { emotion: string; pitch: number; tempo: number }> = {
  institution: { emotion: "tonedown", pitch: -2, tempo: 0.95 },
  family: { emotion: "sad", pitch: 1, tempo: 1.12 },
  loan: { emotion: "happy", pitch: 0, tempo: 1.12 },
};

// --- 프로바이더 호출 --------------------------------------------------------

type Synth = { audio: Buffer; sampleRate: number; ttfbMs: number };

/** 응답 본문의 첫 바이트가 도착한 시각을 재면서 전부 모은다. */
async function drain(res: Response, startedAt: number): Promise<{ body: Buffer; ttfbMs: number }> {
  if (!res.body) throw new Error("응답 본문이 없습니다.");
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let ttfbMs = -1;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.length) {
      if (ttfbMs < 0) ttfbMs = performance.now() - startedAt;
      chunks.push(Buffer.from(value));
    }
  }
  return { body: Buffer.concat(chunks), ttfbMs: ttfbMs < 0 ? performance.now() - startedAt : ttfbMs };
}

async function elevenSynth(voiceId: string, text: string, scenario: ScenarioId): Promise<Synth> {
  if (!ELEVEN_KEY) throw new Error("ELEVENLABS_API_KEY가 없습니다.");
  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
    `?output_format=pcm_24000&optimize_streaming_latency=3`;
  const { speed, ...voiceSettings } = ELEVEN_SETTINGS[scenario];
  const startedAt = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_MODEL,
      language_code: "ko",
      voice_settings: { ...voiceSettings, speed },
    }),
  });
  if (!res.ok) throw new Error(`eleven ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { body, ttfbMs } = await drain(res, startedAt);
  return { audio: body, sampleRate: 24000, ttfbMs };
}

async function typecastSynth(voiceId: string, text: string, scenario: ScenarioId): Promise<Synth> {
  if (!TYPECAST_KEY) throw new Error("TYPECAST_API_KEY가 없습니다.");
  const p = TYPECAST_PROMPT[scenario];
  const startedAt = performance.now();
  const res = await fetch("https://api.typecast.ai/v1/text-to-speech/stream", {
    method: "POST",
    headers: { "X-API-KEY": TYPECAST_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      voice_id: voiceId,
      text,
      model: TYPECAST_MODEL,
      language: "kor",
      prompt: { emotion_type: p.emotion },
      // 스트리밍에서는 volume을 못 쓴다. 레벨은 target_lufs로만 맞춘다.
      output: { audio_format: "wav", audio_pitch: p.pitch, audio_tempo: p.tempo, target_lufs: -16 },
    }),
  });
  if (!res.ok) throw new Error(`typecast ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { body, ttfbMs } = await drain(res, startedAt);
  // 첫 청크에 44바이트 WAV 헤더가 붙어 온다. 32kHz/16bit/mono.
  const pcm = body.subarray(0, 4).toString("ascii") === "RIFF" ? body.subarray(44) : body;
  return { audio: pcm, sampleRate: 32000, ttfbMs };
}

type ProviderId = "eleven" | "typecast";

const PROVIDERS: Record<ProviderId, { synth: typeof elevenSynth; key: string | undefined }> = {
  eleven: { synth: elevenSynth, key: ELEVEN_KEY },
  typecast: { synth: typecastSynth, key: TYPECAST_KEY },
};

function activeProviders(only?: string): ProviderId[] {
  const ids = (Object.keys(PROVIDERS) as ProviderId[]).filter((id) => PROVIDERS[id].key);
  return only ? ids.filter((id) => id === only) : ids;
}

// --- voice 목록 -------------------------------------------------------------

type VoiceCandidate = {
  provider: ProviderId;
  voiceId: string;
  name: string;
  detail: string;
  /** ElevenLabs 라이브러리 voice의 소유자. 워크스페이스에 추가할 때 필요하다. */
  ownerId?: string;
};

// ElevenLabs 기본 제공 voice는 전부 영어 원어민이라 한국어를 읽히면 억양이 남는다.
// 한국어 네이티브는 라이브러리의 Professional 클론에만 있고, 그쪽에 언어 태그가 붙는다.
// (무료 티어는 라이브러리 API를 못 쓴다 — Starter 이상 필요)
async function elevenKoreanVoices(): Promise<VoiceCandidate[]> {
  const url =
    "https://api.elevenlabs.io/v1/shared-voices" +
    "?language=ko&category=professional&page_size=40&sort=cloned_by_count";
  const res = await fetch(url, { headers: { "xi-api-key": ELEVEN_KEY! } });
  if (!res.ok) throw new Error(`eleven voices ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as { voices?: Array<Record<string, string>> };
  return (body.voices ?? []).map((v) => ({
    provider: "eleven" as const,
    voiceId: v.voice_id,
    name: v.name,
    ownerId: v.public_owner_id,
    detail: [v.gender, v.age, v.accent, v.descriptive, v.use_case].filter(Boolean).join(" / "),
  }));
}

// 라이브러리 voice는 워크스페이스에 추가해야 TTS에서 쓸 수 있다. 추가는 소유자가 나중에
// 공유를 내려도 우리 쪽 voice_id가 살아남게 하는 고정 장치이기도 하다 — 심사 기간에
// 404가 나면 그대로 결격이므로 스파이크 단계에서 미리 붙여 둔다.
const addedVoices = new Map<string, string>();

async function ensureElevenVoice(v: VoiceCandidate): Promise<string> {
  if (!v.ownerId) return v.voiceId; // 이미 내 워크스페이스 voice
  const cached = addedVoices.get(v.voiceId);
  if (cached) return cached;

  const res = await fetch(`https://api.elevenlabs.io/v1/voices/add/${v.ownerId}/${v.voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": ELEVEN_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: `spike-${v.name}`.slice(0, 100) }),
  });
  if (!res.ok) {
    // 이미 추가돼 있으면 원래 id가 그대로 동작한다. 그 외 실패는 호출자가 보게 둔다.
    const detail = (await res.text()).slice(0, 200);
    if (!/already/i.test(detail)) throw new Error(`eleven add ${res.status}: ${detail}`);
    addedVoices.set(v.voiceId, v.voiceId);
    return v.voiceId;
  }
  const body = (await res.json()) as { voice_id?: string };
  const id = body.voice_id ?? v.voiceId;
  addedVoices.set(v.voiceId, id);
  return id;
}

/** 프로바이더에 맞는, 실제로 합성에 쓸 수 있는 voice id. */
async function usableVoiceId(v: VoiceCandidate): Promise<string> {
  return v.provider === "eleven" ? ensureElevenVoice(v) : v.voiceId;
}

async function typecastKoreanVoices(): Promise<VoiceCandidate[]> {
  const res = await fetch("https://api.typecast.ai/v2/voices", {
    headers: { "X-API-KEY": TYPECAST_KEY! },
  });
  if (!res.ok) throw new Error(`typecast voices ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as Array<Record<string, unknown>>;
  const list = Array.isArray(body) ? body : ((body as Record<string, unknown>).voices as typeof body) ?? [];
  return list
    .filter((v) => {
      const models = v.models ?? v.model;
      return !Array.isArray(models) || models.includes(TYPECAST_MODEL);
    })
    .map((v) => ({
      provider: "typecast" as const,
      voiceId: String(v.voice_id ?? v.id),
      name: String(v.voice_name ?? v.name ?? ""),
      detail: [v.gender, v.age, v.use_case].filter(Boolean).join(" / "),
    }));
}

// --- WAV --------------------------------------------------------------------

/** 16bit mono PCM에 WAV 헤더를 씌운다. 브라우저가 그대로 디코드할 수 있게. */
function toWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// --- 통계 --------------------------------------------------------------------

function percentile(values: number[], p: number): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

const ms = (n: number) => `${Math.round(n)}ms`;

// --- 모드: moderation --------------------------------------------------------

// 가장 먼저 돌려야 하는 게이트. 사기범 대사를 프로바이더가 거부하면 나머지 측정은 의미가 없다.
async function runModeration(only?: string) {
  const providers = activeProviders(only);
  if (!providers.length) return console.error("키가 설정된 프로바이더가 없습니다.");

  console.log("=== moderation ===");
  console.log("사기범 대사를 각 프로바이더가 합성해 주는지 확인한다.\n");

  const rows: string[] = [];
  for (const provider of providers) {
    // voice는 아무거나 하나면 된다. 거부는 텍스트를 보고 일어난다.
    const voices = provider === "eleven" ? await elevenKoreanVoices() : await typecastKoreanVoices();
    const voice = voices[0];
    if (!voice) {
      rows.push(`${provider}: 한국어 voice를 못 찾아 확인 불가`);
      continue;
    }
    for (const line of spikeLines()) {
      try {
        const out = await PROVIDERS[provider].synth(await usableVoiceId(voice), line.text, line.scenario);
        const ok = out.audio.length > 0;
        rows.push(`${provider} ${line.scenario}/${line.kind}: ${ok ? "합성됨" : "빈 응답"} (${out.audio.length}B)`);
      } catch (err) {
        rows.push(`${provider} ${line.scenario}/${line.kind}: 거부/실패 — ${(err as Error).message}`);
      }
    }
  }
  rows.forEach((r) => console.log(" ", r));
  console.log("\n판정: 한 프로바이더의 대사가 전부 '합성됨'이어야 그 프로바이더가 후보로 남는다.");
}

// --- 모드: voices ------------------------------------------------------------

async function runVoices(only?: string) {
  for (const provider of activeProviders(only)) {
    const voices = provider === "eleven" ? await elevenKoreanVoices() : await typecastKoreanVoices();
    console.log(`\n=== ${provider} 한국어 voice (${voices.length}) ===`);
    voices.forEach((v) => console.log(`  ${v.voiceId}  ${v.name.padEnd(24)} ${v.detail}`));
    if (provider === "eleven" && !voices.length)
      console.log("  (비어 있음 — 무료 티어는 라이브러리 API를 쓸 수 없다. Starter 이상 필요)");
  }
  console.log("\n배역별 3~5개를 골라 --voices 인자로 samples에 넘긴다.");
  console.log("  institution: 낮고 건조한 40대 남성 / family: 20대 후반 남성 / loan: 30대 여성 상담원");
}

// --- 모드: samples -----------------------------------------------------------

type Manifest = {
  createdAt: string;
  blind: Record<string, { provider: string; voiceId: string; voiceName: string; scenario: string; kind: string }>;
};

// 파일명이 정답을 흘리면 블라인드가 아니다. 해시로 바꾸고 매핑은 manifest에만 남긴다.
async function runSamples(only: string | undefined, voiceArg: string | undefined) {
  const providers = activeProviders(only);
  if (!providers.length) return console.error("키가 설정된 프로바이더가 없습니다.");

  mkdirSync(SAMPLE_DIR, { recursive: true });
  const manifest: Manifest = { createdAt: new Date().toISOString(), blind: {} };
  const picked = voiceArg?.split(",").map((s) => s.trim()).filter(Boolean);

  for (const provider of providers) {
    const all = provider === "eleven" ? await elevenKoreanVoices() : await typecastKoreanVoices();
    const voices = picked ? all.filter((v) => picked.includes(v.voiceId)) : all.slice(0, 4);
    if (!voices.length) {
      console.error(`${provider}: 대상 voice가 없습니다.`);
      continue;
    }
    for (const voice of voices) {
      for (const line of spikeLines()) {
        try {
          const out = await PROVIDERS[provider].synth(await usableVoiceId(voice), line.text, line.scenario);
          const blindId = createHash("sha256")
            .update(`${randomUUID()}|${provider}|${voice.voiceId}|${line.scenario}|${line.kind}`)
            .digest("hex")
            .slice(0, 12);
          writeFileSync(join(SAMPLE_DIR, `${blindId}.wav`), toWav(out.audio, out.sampleRate));
          manifest.blind[blindId] = {
            provider,
            voiceId: voice.voiceId,
            voiceName: voice.name,
            scenario: line.scenario,
            kind: line.kind,
          };
          console.log(`  ${blindId}  ${provider} ${voice.name} ${line.scenario}/${line.kind} (${ms(out.ttfbMs)})`);
        } catch (err) {
          console.error(`  실패 ${provider} ${voice.name} ${line.scenario}/${line.kind}: ${(err as Error).message}`);
        }
      }
    }
  }

  const ids = Object.keys(manifest.blind);
  // 청취 페이지가 읽는 목록. 정답표는 여기에 넣지 않는다.
  writeFileSync(join(SAMPLE_DIR, "index.json"), JSON.stringify(ids.map((id) => `${id}.wav`), null, 2));
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n${ids.length}개 샘플 → ${SAMPLE_DIR}`);
  console.log(`정답표 → ${join(OUT_DIR, "manifest.json")} (청취가 끝날 때까지 열지 말 것)`);
  console.log("청취: npm run dev 후 http://localhost:3000/spike/listen");
  console.log("현행 목소리 대조군: eval-runs/2026-08-16T09-04-prosody-v4/audio/*.wav");
}

// --- 모드: latency -----------------------------------------------------------

async function runLatency(only: string | undefined, reps: number, voiceArg: string | undefined) {
  const providers = activeProviders(only);
  if (!providers.length) return console.error("키가 설정된 프로바이더가 없습니다.");

  console.log(`=== latency (${reps}회/조합) ===`);
  console.log("데모에 쓸 노트북·네트워크에서 재야 의미가 있다.\n");

  for (const provider of providers) {
    const all = provider === "eleven" ? await elevenKoreanVoices() : await typecastKoreanVoices();
    const picked = voiceArg?.split(",").map((s) => s.trim());
    const voice = all.find((v) => picked?.includes(v.voiceId)) ?? all[0];
    if (!voice) continue;

    // 오프닝 세 개만 쓴다. 첫 문장의 지연이 통화 체감을 좌우한다.
    const lines = spikeLines().filter((l) => l.kind === "opening");
    const samples: number[] = [];
    const voiceId = await usableVoiceId(voice);
    for (let i = 0; i < reps; i++) {
      const line = lines[i % lines.length];
      try {
        const out = await PROVIDERS[provider].synth(voiceId, line.text, line.scenario);
        samples.push(out.ttfbMs);
      } catch (err) {
        console.error(`  실패: ${(err as Error).message}`);
      }
    }
    if (!samples.length) continue;
    console.log(
      `  ${provider.padEnd(9)} n=${samples.length}  p50 ${ms(percentile(samples, 50))}  ` +
        `p95 ${ms(percentile(samples, 95))}  min ${ms(Math.min(...samples))}  max ${ms(Math.max(...samples))}`,
    );
  }
  console.log("\n중단 기준: 두 프로바이더 모두 TTFB p95 > 400ms면 이 경로를 접는다.");
  console.log("주의: Typecast는 브라우저에서 직결이 안 되고 프록시 홉이 하나 더 붙는다.");
}

// --- 모드: baseline ----------------------------------------------------------

// 현행 Realtime의 "발화 종료 → 첫 소리" 지연. 한 번도 실측된 적이 없어서, 이 값 없이는
// 교체 후 수치가 회귀인지 개선인지 말할 수 없다. eval 하네스와 같은 WebSocket 경로를 쓴다.
// 브라우저 WebRTC는 여기에 지터가 더 붙으므로 이 값은 하한이다.
async function runBaseline(reps: number) {
  if (!process.env.OPENAI_API_KEY) return console.error("OPENAI_API_KEY가 없습니다.");

  console.log(`=== baseline: 현행 Realtime 응답 지연 (${reps}회) ===`);
  console.log("WebSocket 경로 기준이라 브라우저 WebRTC의 지터가 빠진 하한값이다.\n");

  const scenario = SCENARIOS[0];
  const opening: number[] = [];
  const turn: number[] = [];

  for (let i = 0; i < reps; i++) {
    try {
      const r = await oneBaselineCall(scenario);
      opening.push(r.openingMs);
      turn.push(r.turnMs);
      console.log(`  ${i + 1}/${reps}: 오프닝 ${ms(r.openingMs)}  대화 중 턴 ${ms(r.turnMs)}`);
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
    }
  }

  const report = (label: string, xs: number[]) =>
    xs.length &&
    console.log(
      `  ${label.padEnd(12)} n=${xs.length}  p50 ${ms(percentile(xs, 50))}  p95 ${ms(percentile(xs, 95))}  ` +
        `min ${ms(Math.min(...xs))}  max ${ms(Math.max(...xs))}`,
    );

  console.log("");
  report("오프닝", opening);
  report("대화 중 턴", turn);
  console.log("\n오프닝은 전체 지시문이 통째로 실리는 최악 조건이다. 교체 후 비교 기준은 '대화 중 턴'.");
  console.log("합격선: 대화 중 턴 p50이 위 값 대비 +350ms 이내.");
}

/** 훈련자 대사 PCM. eval 하네스와 같은 캐시 키를 쓴다 (24kHz mono). */
async function victimPcm(text: string): Promise<Buffer> {
  const key = createHash("sha256").update(`${VICTIM_VOICE}|${VICTIM_TONE}|${text}`).digest("hex").slice(0, 32);
  const path = join(".eval-cache", `${key}.pcm`);
  if (existsSync(path)) return readFileSync(path);
  const res = await new OpenAI().audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VICTIM_VOICE,
    input: text,
    instructions: VICTIM_TONE,
    response_format: "pcm",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  mkdirSync(".eval-cache", { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

/**
 * 통화 한 번에서 두 지연을 잰다.
 *   openingMs — response.create → 첫 오디오 델타 (전체 지시문이 실리는 최악 조건)
 *   turnMs    — speech_stopped → 첫 오디오 델타 (실제 대화 중 체감 지연)
 */
async function oneBaselineCall(scenario: (typeof SCENARIOS)[number]): Promise<{ openingMs: number; turnMs: number }> {
  const pcm = await victimPcm(SCRIPTS[scenario.id].skeptical[0].text);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${REALTIME_MODEL}`, [
      "realtime",
      `openai-insecure-api-key.${process.env.OPENAI_API_KEY}`,
    ]);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("60초 안에 끝나지 않았습니다."));
    }, 60_000);

    let phase: "opening" | "speaking" | "turn" = "opening";
    let askedAt = 0;
    let stoppedAt = 0;
    let openingMs = 0;

    const finish = (value: { openingMs: number; turnMs: number } | Error) => {
      clearTimeout(timer);
      ws.close();
      if (value instanceof Error) reject(value);
      else resolve(value);
    };

    /** 훈련자 대사를 실시간 속도로 흘려보낸다. 앞뒤 여백은 서버 VAD가 턴을 끊게 하는 조건이다. */
    const streamVictim = async () => {
      const lead = Buffer.alloc((BYTES_PER_SEC * 300) / 1000);
      const tail = Buffer.alloc((BYTES_PER_SEC * 1200) / 1000);
      const all = Buffer.concat([lead, pcm, tail]);
      for (let off = 0; off < all.length; off += FRAME_BYTES) {
        ws.send(
          JSON.stringify({
            type: "input_audio_buffer.append",
            audio: all.subarray(off, off + FRAME_BYTES).toString("base64"),
          }),
        );
        await new Promise((r) => setTimeout(r, FRAME_MS));
      }
    };

    ws.onopen = () => {
      // WebSocket은 모델을 URL 쿼리로 고정하므로 session에서 model을 뺀다.
      const session: Record<string, unknown> = { ...buildSessionConfig(scenario) };
      delete session.model;
      ws.send(JSON.stringify({ type: "session.update", session }));
    };
    ws.onerror = () => finish(new Error("WebSocket 오류"));
    ws.onmessage = (e) => {
      const ev = JSON.parse(String(e.data)) as { type: string; error?: { message?: string } };
      switch (ev.type) {
        case "session.updated":
          askedAt = performance.now();
          ws.send(
            JSON.stringify({
              type: "response.create",
              response: { instructions: openingResponseInstructions(scenario) },
            }),
          );
          break;
        case "response.output_audio.delta":
          if (phase === "opening") {
            openingMs = performance.now() - askedAt;
            phase = "speaking";
          } else if (phase === "turn" && stoppedAt) {
            finish({ openingMs, turnMs: performance.now() - stoppedAt });
          }
          break;
        case "response.done":
          // 사기꾼이 말을 마쳤다. 이제 훈련자가 말한다.
          if (phase === "speaking") {
            phase = "turn";
            streamVictim().catch(() => {});
          }
          break;
        case "input_audio_buffer.speech_stopped":
          stoppedAt = performance.now();
          break;
        case "error":
          finish(new Error(ev.error?.message ?? "알 수 없는 오류"));
          break;
      }
    };
  });
}

// --- 진입점 ------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const mode = process.argv[2];
  const only = arg("provider");
  const reps = Number(arg("reps") ?? 20);
  const voices = arg("voices");

  mkdirSync(OUT_DIR, { recursive: true });

  switch (mode) {
    case "moderation":
      return runModeration(only);
    case "voices":
      return runVoices(only);
    case "samples":
      return runSamples(only, voices);
    case "latency":
      return runLatency(only, reps, voices);
    case "baseline":
      return runBaseline(Number(arg("reps") ?? 10));
    default:
      console.log("사용법: node --env-file=.env scripts/tts-spike.ts <mode>");
      console.log("  moderation | voices | samples | latency | baseline");
      console.log("  옵션: --provider eleven|typecast  --reps N  --voices id1,id2");
      console.log("\n권장 순서: moderation → voices → samples(청취) → latency");
      console.log("baseline은 키 없이 지금 바로 돌릴 수 있다.");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
