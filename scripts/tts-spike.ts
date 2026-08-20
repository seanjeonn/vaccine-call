// Typecast TTS 검증 스파이크 (Phase 0).
//
// 훈련 통화(F1)의 목소리를 gpt-realtime에서 Typecast로 옮길지 판단하기 위한 측정 도구다.
// 판단 근거를 각각 따로 잰다. 순서가 중요하다 — moderation이 막히면 나머지를 잴 이유가 없다.
//
//   moderation  사기범 대사를 합성해 주는가                (막히면 전면 중단)
//   voices      한국어 voice 후보 목록                      (samples의 입력)
//   samples     후보별 시나리오 대사 합성 → 블라인드 청취용 파일
//   latency     첫 오디오 바이트까지의 지연 (TTFB)
//   baseline    현행 Realtime의 발화 종료 → 첫 소리 지연
//
// baseline은 OPENAI_API_KEY만 쓴다. 나머지는 TYPECAST_API_KEY가 필요하다.
//
// 사용법: node --env-file=.env scripts/tts-spike.ts <mode> [--reps 20] [--voices id1,id2]
//
// 청취는 파일을 직접 듣지 말고 npm run dev 후 /spike/listen 에서 한다. 그 페이지가
// lib/telephone-audio.ts의 실제 체인을 통과시킨다. 협대역으로 깎이기 전 소리를 비교하면
// 프로덕션에서 들릴 소리와 다른 것을 고르게 된다.

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { SCENARIOS, type ScenarioId } from "../lib/scenarios.ts";
import { SCENARIO_VOICES, TYPECAST_SAMPLE_RATE, typecastRequest, type VoiceSpec } from "../lib/tts-voices.ts";
import { REALTIME_MODEL, buildSessionConfig, openingResponseInstructions } from "../lib/realtime-session.ts";
import { SCRIPTS, VICTIM_TONE, VICTIM_VOICE } from "./victim-scripts.ts";

const OUT_DIR = "spike-out";
// 청취 페이지(/spike/listen)가 바로 읽을 수 있게 public 아래에 쓴다. .gitignore 대상이다.
const SAMPLE_DIR = join("public", "spike");

// eval 하네스와 같은 프레이밍. 서버 VAD가 프로덕션과 같은 조건에서 턴을 끊게 한다.
const BYTES_PER_SEC = 24000 * 2; // 16bit mono
const FRAME_MS = 40;
const FRAME_BYTES = (BYTES_PER_SEC * FRAME_MS) / 1000; // 1920

const TYPECAST_KEY = process.env.TYPECAST_API_KEY;
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

// --- Typecast 호출 -----------------------------------------------------------

// ttfb는 첫 바이트, ttfa는 44바이트 WAV 헤더를 넘어선 첫 오디오 바이트까지의 시간이다.
// Typecast는 헤더를 합성 전에 먼저 흘려보내므로 ttfb만 보면 실제보다 빠르게 보인다.
type Synth = { audio: Buffer; ttfbMs: number; ttfaMs: number };

async function synth(voiceId: string, text: string, scenario: ScenarioId): Promise<Synth> {
  if (!TYPECAST_KEY) throw new Error("TYPECAST_API_KEY가 없습니다.");
  // 배역의 톤 파라미터는 쓰되 목소리는 호출자가 정한다 — 후보를 바꿔 가며 듣기 위해서다.
  const spec: VoiceSpec = { ...SCENARIO_VOICES[scenario], voiceId };
  const startedAt = performance.now();
  const res = await fetch("https://api.typecast.ai/v1/text-to-speech/stream", {
    method: "POST",
    headers: { "X-API-KEY": TYPECAST_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(typecastRequest(spec, text)),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    // 422 VALIDATION_ERROR는 우리 요청이 틀린 것이지 대사가 막힌 게 아니다.
    // 이 둘을 섞으면 스키마 실수를 모더레이션 차단으로 오판하게 된다.
    const err = new Error(`typecast ${res.status}: ${detail}`) as Error & { kind?: string };
    err.kind = res.status === 422 || /VALIDATION_ERROR/.test(detail) ? "request" : "refused";
    throw err;
  }
  if (!res.body) throw new Error("응답 본문이 없습니다.");

  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  let ttfbMs = -1;
  let ttfaMs = -1;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value?.length) continue;
    const now = performance.now() - startedAt;
    if (ttfbMs < 0) ttfbMs = now;
    received += value.length;
    // 헤더 44바이트를 넘긴 첫 순간이 소리가 실제로 나기 시작하는 시점이다.
    if (ttfaMs < 0 && received > 44) ttfaMs = now;
    chunks.push(Buffer.from(value));
  }
  const body = Buffer.concat(chunks);
  const audio = body.subarray(0, 4).toString("ascii") === "RIFF" ? body.subarray(44) : body;
  const fallback = performance.now() - startedAt;
  return { audio, ttfbMs: ttfbMs < 0 ? fallback : ttfbMs, ttfaMs: ttfaMs < 0 ? fallback : ttfaMs };
}

// --- voice 목록 -------------------------------------------------------------

type Voice = { voiceId: string; name: string; gender: string; age: string; useCases: string[] };

// 카탈로그에 언어 필드가 없다. Typecast는 한국어가 기본이고 596개가 전부 한국어 voice다.
// 그래서 언어가 아니라 배역으로 좁혀야 한다.
const ROLE_FILTER: Record<ScenarioId, { gender: string; ages: string[]; useCases: string[] }> = {
  // 낮고 건조한 40대 남성 수사관 — 뉴스·다큐 계열이 사무적인 톤에 가깝다.
  institution: {
    gender: "male",
    ages: ["middle_age"],
    useCases: ["News Reporter", "Announcer", "Documentary", "Conversational"],
  },
  // 숨차고 다급한 20대 후반 남성 — 감정 폭이 큰 연기 계열.
  family: {
    gender: "male",
    ages: ["young_adult"],
    useCases: ["Conversational", "Audiobook/Storytelling", "Anime"],
  },
  // 매끄럽고 빠른 30대 여성 상담원 — 안내·광고 계열.
  loan: {
    gender: "female",
    ages: ["young_adult", "middle_age"],
    useCases: ["Voicemail/Voice Assistant", "Ads/Promotion", "Announcer", "Conversational"],
  },
};

async function allVoices(): Promise<Voice[]> {
  if (!TYPECAST_KEY) throw new Error("TYPECAST_API_KEY가 없습니다.");
  const res = await fetch("https://api.typecast.ai/v2/voices", {
    headers: { "X-API-KEY": TYPECAST_KEY },
  });
  if (!res.ok) throw new Error(`typecast voices ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : ((body as { voices?: unknown[] }).voices ?? [])) as Array<
    Record<string, unknown>
  >;
  return list
    // models는 문자열이 아니라 {version, emotions} 객체 배열이다.
    .filter((v) => (v.models as Array<{ version?: string }> | undefined)?.some((m) => m.version === TYPECAST_MODEL))
    .map((v) => ({
      voiceId: String(v.voice_id),
      name: String(v.voice_name ?? ""),
      gender: String(v.gender ?? ""),
      age: String(v.age ?? ""),
      useCases: (v.use_cases as string[] | undefined) ?? [],
    }));
}

/** 배역에 맞는 후보. use_case가 앞쪽에 적힌 것일수록 그 배역에 가깝다고 보고 정렬한다. */
function candidatesFor(voices: Voice[], scenario: ScenarioId, limit: number): Voice[] {
  const f = ROLE_FILTER[scenario];
  return voices
    .filter((v) => v.gender === f.gender && f.ages.includes(v.age) && v.useCases.some((u) => f.useCases.includes(u)))
    .map((v) => ({ v, rank: Math.min(...v.useCases.map((u) => f.useCases.indexOf(u)).filter((i) => i >= 0)) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map(({ v }) => v);
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

// 가장 먼저 돌려야 하는 게이트. Typecast가 사기범 대사를 거부하면 나머지 측정은 의미가 없고,
// 대안 프로바이더도 없으므로 그대로 전면 중단이다.
async function runModeration() {
  console.log("=== moderation ===");
  console.log("사기범 대사를 Typecast가 합성해 주는지 확인한다.\n");

  // voice는 아무거나 하나면 된다. 거부는 텍스트를 보고 일어난다.
  const [voice] = await allVoices();
  if (!voice) return console.error("voice를 찾지 못했습니다.");

  let refused = 0;
  let broken = 0;
  for (const line of spikeLines()) {
    try {
      const out = await synth(voice.voiceId, line.text, line.scenario);
      console.log(`  ${line.scenario}/${line.kind}: 합성됨 (${out.audio.length}B)`);
    } catch (err) {
      const e = err as Error & { kind?: string };
      if (e.kind === "request") broken++;
      else refused++;
      console.log(`  ${line.scenario}/${line.kind}: ${e.kind === "request" ? "요청 오류" : "거부"} — ${e.message}`);
    }
  }
  if (broken) {
    console.log(`\n판정 불가. ${broken}개가 요청 스키마 오류로 실패했다. 스크립트를 고치고 다시 돌린다.`);
  } else if (refused) {
    console.log(`\n중단. ${refused}개 대사가 막혔다. 대안 프로바이더가 없으므로 이 경로를 접는다.`);
  } else {
    console.log("\n통과. 6개 대사 전부 합성됐다.");
  }
}

// --- 모드: voices ------------------------------------------------------------

async function runVoices(limit: number) {
  const voices = await allVoices();
  console.log(`=== Typecast voice: 전체 ${voices.length}개 중 배역별 상위 ${limit}개 ===\n`);

  for (const s of SCENARIOS) {
    const picks = candidatesFor(voices, s.id, limit);
    console.log(`${s.id} — ${s.ttsInstructions.split(".")[0]}.`);
    if (!picks.length) console.log("  (조건에 맞는 voice 없음 — ROLE_FILTER를 넓혀야 한다)");
    picks.forEach((v) =>
      console.log(`  ${v.voiceId}  ${v.name.padEnd(18)} ${v.gender}/${v.age}  ${v.useCases.join(", ")}`),
    );
    console.log("");
  }
  console.log("samples는 인자 없이 돌리면 위 후보를 그대로 쓴다.");
  console.log("특정 voice만 듣고 싶으면 --voices id1,id2 (배역 3종 대사를 모두 읽힌다).");
}

// --- 모드: samples -----------------------------------------------------------

type Manifest = {
  createdAt: string;
  blind: Record<string, { voiceId: string; voiceName: string; scenario: string; kind: string }>;
};

// 파일명이 정답을 흘리면 블라인드가 아니다. 해시로 바꾸고 매핑은 manifest에만 남긴다.
async function runSamples(voiceArg: string | undefined, limit: number) {
  const all = await allVoices();
  const wanted = voiceArg?.split(",").map((x) => x.trim()).filter(Boolean);

  // 기본은 배역별 후보에게 그 배역 대사만 읽힌다 — 여성 목소리에게 아들 대사를 읽힐 이유가 없다.
  // --voices로 지정하면 그 voice들이 배역 3종을 전부 읽는다. 한 목소리의 폭을 보려는 용도다.
  const work = wanted
    ? all.filter((v) => wanted.includes(v.voiceId)).flatMap((v) => spikeLines().map((line) => ({ voice: v, line })))
    : SCENARIOS.flatMap((s) =>
        candidatesFor(all, s.id, limit).flatMap((v) =>
          spikeLines()
            .filter((l) => l.scenario === s.id)
            .map((line) => ({ voice: v, line })),
        ),
      );

  if (!work.length) return console.error("대상 voice가 없습니다.");

  mkdirSync(SAMPLE_DIR, { recursive: true });
  const manifest: Manifest = { createdAt: new Date().toISOString(), blind: {} };

  {
    for (const { voice, line } of work) {
      try {
        const out = await synth(voice.voiceId, line.text, line.scenario);
        const blindId = createHash("sha256")
          .update(`${randomUUID()}|${voice.voiceId}|${line.scenario}|${line.kind}`)
          .digest("hex")
          .slice(0, 12);
        writeFileSync(join(SAMPLE_DIR, `${blindId}.wav`), toWav(out.audio, TYPECAST_SAMPLE_RATE));
        manifest.blind[blindId] = {
          voiceId: voice.voiceId,
          voiceName: voice.name,
          scenario: line.scenario,
          kind: line.kind,
        };
        console.log(`  ${blindId}  ${voice.name.padEnd(18)} ${line.scenario}/${line.kind} (${ms(out.ttfbMs)})`);
      } catch (err) {
        console.error(`  실패 ${voice.name} ${line.scenario}/${line.kind}: ${(err as Error).message}`);
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

// --- 모드: assigned ----------------------------------------------------------

// 최종 배정(lib/tts-voices.ts)을 그대로 렌더한다. 후보 청취와 다른 점은 두 가지다 —
// 목소리와 배역이 실제 조합대로 붙고, 파일명이 블라인드가 아니다. 배정을 바꿀 때마다
// 이걸 돌려 확인한다.
async function runAssigned() {
  const all = await allVoices();
  const name = (id: string) => all.find((v) => v.voiceId === id)?.name ?? "(카탈로그에 없음)";

  mkdirSync(SAMPLE_DIR, { recursive: true });
  const files: string[] = [];

  console.log("=== 최종 배정 렌더 ===\n");
  for (const s of SCENARIOS) {
    const spec = SCENARIO_VOICES[s.id];
    console.log(`${s.id} → ${name(spec.voiceId)} (${spec.emotion} ${spec.intensity}, pitch ${spec.pitch}, tempo ${spec.tempo})`);
    for (const line of spikeLines().filter((l) => l.scenario === s.id)) {
      try {
        const out = await synth(spec.voiceId, line.text, s.id);
        const file = `assigned-${s.id}-${line.kind}.wav`;
        writeFileSync(join(SAMPLE_DIR, file), toWav(out.audio, TYPECAST_SAMPLE_RATE));
        files.push(file);
        console.log(`  ${file}`);
      } catch (err) {
        console.error(`  실패 ${line.kind}: ${(err as Error).message}`);
      }
    }
  }

  writeFileSync(join(SAMPLE_DIR, "index.json"), JSON.stringify(files, null, 2));
  console.log("\n청취: npm run dev 후 http://localhost:3000/spike/listen");
  console.log("이번엔 파일명에 배역이 드러난다. 배정 확인용이라 블라인드가 아니다.");
}

// --- 모드: latency -----------------------------------------------------------

async function runLatency(reps: number, voiceArg: string | undefined) {
  const all = await allVoices();
  const wanted = voiceArg?.split(",").map((x) => x.trim());
  const voice = all.find((v) => wanted?.includes(v.voiceId)) ?? candidatesFor(all, "institution", 1)[0] ?? all[0];
  if (!voice) return console.error("대상 voice가 없습니다.");

  console.log(`=== latency (${reps}회, ${voice.name}) ===`);
  console.log("데모에 쓸 노트북·네트워크에서 재야 의미가 있다.\n");

  // 오프닝 세 개만 쓴다. 첫 문장의 지연이 통화 체감을 좌우한다.
  const lines = spikeLines().filter((l) => l.kind === "opening");
  const ttfb: number[] = [];
  const ttfa: number[] = [];
  for (let i = 0; i < reps; i++) {
    const line = lines[i % lines.length];
    try {
      const out = await synth(voice.voiceId, line.text, line.scenario);
      ttfb.push(out.ttfbMs);
      ttfa.push(out.ttfaMs);
    } catch (err) {
      console.error(`  실패: ${(err as Error).message}`);
    }
  }
  if (!ttfa.length) return;

  const row = (label: string, xs: number[]) =>
    console.log(
      `  ${label.padEnd(16)} n=${xs.length}  p50 ${ms(percentile(xs, 50))}  p95 ${ms(percentile(xs, 95))}  ` +
        `min ${ms(Math.min(...xs))}  max ${ms(Math.max(...xs))}`,
    );
  row("첫 바이트", ttfb);
  row("첫 오디오", ttfa);
  console.log("\n첫 바이트는 WAV 헤더라 합성 전에 나간다. 판정은 '첫 오디오'로 한다.");
  console.log("중단 기준: 첫 오디오 p95 > 400ms면 이 경로를 접는다.");
  console.log("주의: 이 값은 서버에서 직결로 잰 것이다. 브라우저는 키를 못 들고 있어");
  console.log("      Next 라우트를 경유하므로 실제로는 프록시 홉이 하나 더 붙는다.");
}

// --- 모드: baseline ----------------------------------------------------------

// 현행 Realtime의 "발화 종료 → 첫 소리" 지연. 한 번도 실측된 적이 없어서, 이 값 없이는
// 교체 후 수치가 회귀인지 개선인지 말할 수 없다. eval 하네스와 같은 WebSocket 경로를 쓴다.
// 브라우저 WebRTC는 여기에 지터가 더 붙으므로 이 값은 하한이다.
async function runBaseline(reps: number, textOut: boolean) {
  if (!process.env.OPENAI_API_KEY) return console.error("OPENAI_API_KEY가 없습니다.");

  console.log(`=== baseline: ${textOut ? "텍스트 출력" : "현행 오디오 출력"} 응답 지연 (${reps}회) ===`);
  console.log("WebSocket 경로 기준이라 브라우저 WebRTC의 지터가 빠진 하한값이다.\n");

  const scenario = SCENARIOS[0];
  const opening: number[] = [];
  const turn: number[] = [];
  const sentence: number[] = [];
  const firstSentences: string[] = [];

  for (let i = 0; i < reps; i++) {
    try {
      const r = await oneBaselineCall(scenario, textOut);
      opening.push(r.openingMs);
      turn.push(r.turnMs);
      if (r.sentenceMs) {
        sentence.push(r.sentenceMs);
        firstSentences.push(r.firstSentence);
      }
      console.log(
        `  ${i + 1}/${reps}: 오프닝 ${ms(r.openingMs)}  대화 중 턴 ${ms(r.turnMs)}` +
          (r.sentenceMs ? `  첫 문장 완성 ${ms(r.sentenceMs)}` : ""),
      );
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
  report("대화 중 턴(첫 델타)", turn);
  if (sentence.length) report("첫 문장 완성", sentence);
  console.log("\n오프닝은 전체 지시문이 통째로 실리는 최악 조건이다. 비교 기준은 '대화 중 턴'.");
  if (textOut) {
    // Typecast는 완성된 문장을 요청 단위로 받는다. 첫 델타가 아니라 첫 문장이 끝나야 합성이 시작된다.
    console.log("Typecast는 완성된 문장을 받아야 하므로 실제 트리거는 '첫 문장 완성'이다.");
    console.log("교체 후 체감 지연 = 첫 문장 완성 + TTS 첫 오디오.");
    if (firstSentences.length) {
      const lens = firstSentences.map((t) => t.length);
      console.log(`첫 문장 길이: 중앙값 ${percentile(lens, 50)}자 (min ${Math.min(...lens)} / max ${Math.max(...lens)})`);
      console.log(`예: "${firstSentences[0]}"`);
    }
  } else {
    console.log("합격선: 교체 후 대화 중 턴 p50이 이 값 대비 +350ms 이내.");
  }
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
async function oneBaselineCall(
  scenario: (typeof SCENARIOS)[number],
  textOut: boolean,
): Promise<{ openingMs: number; turnMs: number; sentenceMs: number; firstSentence: string }> {
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
    let turnMs = 0;
    let buffered = "";

    const finish = (
      value: { openingMs: number; turnMs: number; sentenceMs: number; firstSentence: string } | Error,
    ) => {
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
      if (textOut) {
        // 오디오 입력(VAD·전사)은 그대로 두고 출력만 텍스트로 돌린다.
        // 이 조합이 실제로 성립하는지도 여기서 함께 확인된다.
        session.output_modalities = ["text"];
        const audio = session.audio as Record<string, unknown>;
        session.audio = { input: audio.input };
      }
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
        case textOut ? "response.output_text.delta" : "response.output_audio.delta":
          if (phase === "opening") {
            openingMs = performance.now() - askedAt;
            phase = "speaking";
          } else if (phase === "turn" && stoppedAt) {
            if (!turnMs) turnMs = performance.now() - stoppedAt;
            if (!textOut) return finish({ openingMs, turnMs, sentenceMs: 0, firstSentence: "" });
            // 문장 경계까지 모은다. 한국어 종결부호 + 줄바꿈.
            buffered += (ev as { delta?: string }).delta ?? "";
            const m = /[.!?…\n]/.exec(buffered);
            if (m) {
              finish({
                openingMs,
                turnMs,
                sentenceMs: performance.now() - stoppedAt,
                firstSentence: buffered.slice(0, m.index + 1).trim(),
              });
            }
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
  const reps = Number(arg("reps") ?? 20);
  const voices = arg("voices");

  mkdirSync(OUT_DIR, { recursive: true });

  switch (mode) {
    case "moderation":
      return runModeration();
    case "voices":
      return runVoices(Number(arg("limit") ?? 6));
    case "samples":
      return runSamples(voices, Number(arg("limit") ?? 4));
    case "assigned":
      return runAssigned();
    case "latency":
      return runLatency(reps, voices);
    case "baseline":
      return runBaseline(Number(arg("reps") ?? 10), process.argv.includes("--text"));
    default:
      console.log("사용법: node --env-file=.env scripts/tts-spike.ts <mode>");
      console.log("  moderation | voices | samples | assigned | latency | baseline");
      console.log("  옵션: --reps N  --voices id1,id2  --limit N(배역별 후보 수)");
      console.log("  baseline --text 는 output_modalities:[\"text\"] 경로를 잰다.");
      console.log("\n권장 순서: moderation → voices → samples(청취) → latency");
      console.log("baseline은 TYPECAST_API_KEY 없이도 돌아간다.");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
