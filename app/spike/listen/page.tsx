"use client";

// TTS 프로바이더 블라인드 청취 (Phase 0). 심사·데모 경로가 아니라 개발용 도구다.
//
// 파일을 그냥 재생하면 안 된다. 통화에서 들리는 소리는 lib/telephone-audio.ts의 체인을
// 통과한 뒤의 소리이고, 협대역(300~3400Hz) + µ-law가 목소리를 크게 바꾼다. 광대역에서
// 좋게 들린 목소리가 통화에서는 구분조차 안 되는 경우가 있다. 그래서 이 페이지는 실제
// 프로덕션 체인을 그대로 물려 재생한다.
//
// 준비: node --env-file=.env scripts/tts-spike.ts samples
//       샘플과 목록을 public/spike/ 에 바로 쓴다. 그 뒤 이 페이지를 연다.
//
// 정답표(spike-out/manifest.json)는 청취가 끝날 때까지 열지 않는다.
//
// 개발 전용이다. 심사 배포에 /spike/listen 이 열려 있으면 안 되므로 프로덕션에서는 404를 낸다.

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import { buildTelephoneChain } from "@/lib/telephone-audio";

type Clip = { id: string; url: string };

// 대조군은 현행 gpt-realtime 목소리다. 추가 비용 없이 이미 저장돼 있다.
const CONTROL_HINT = "eval-runs/2026-08-16T09-04-prosody-v4/audio/";

export default function SpikeListen() {
  if (process.env.NODE_ENV === "production") notFound();

  const [clips, setClips] = useState<Clip[]>([]);
  const [filtered, setFiltered] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctxRef = useRef<AudioContext | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const activeRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    // public/spike/index.json 에 파일 목록을 둔다. 없으면 안내만 띄운다.
    fetch("/spike/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((names: string[]) =>
        // 청취 순서까지 고정되면 그것도 단서가 된다. 열 때마다 섞는다.
        setClips(
          names
            .map((n) => ({ id: n.replace(/\.wav$/, ""), url: `/spike/${n}`, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ id, url }) => ({ id, url })),
        ),
      )
      .catch(() =>
        setError(
          "public/spike/index.json 이 없습니다. scripts/tts-spike.ts samples 를 돌리고 " +
            "spike-out/samples/*.wav 를 public/spike/ 로 옮긴 뒤 파일명 배열을 index.json 에 넣으세요.",
        ),
      );
  }, []);

  const stop = useCallback(() => {
    activeRef.current?.stop();
    activeRef.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(
    async (clip: Clip) => {
      stop();
      const ctx =
        ctxRef.current ??
        (ctxRef.current = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)());
      await ctx.resume().catch(() => {});

      let buffer = buffersRef.current.get(clip.id);
      if (!buffer) {
        const bytes = await fetch(clip.url).then((r) => r.arrayBuffer());
        buffer = await ctx.decodeAudioData(bytes);
        buffersRef.current.set(clip.id, buffer);
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;

      // 여기가 이 페이지의 전부다. 통화와 같은 체인을 그대로 쓴다.
      const chain = filtered ? buildTelephoneChain(ctx) : null;
      if (chain) {
        source.connect(chain.input);
        chain.output.connect(ctx.destination);
      } else {
        source.connect(ctx.destination);
      }

      source.onended = () => {
        chain?.stop();
        setPlaying((cur) => (cur === clip.id ? null : cur));
      };
      source.start();
      activeRef.current = {
        stop: () => {
          try {
            source.stop();
          } catch {
            // 이미 끝난 경우
          }
          chain?.stop();
        },
      };
      setPlaying(clip.id);
    },
    [filtered, stop],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-[720px] flex-col gap-6 p-8 text-sm">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">TTS 블라인드 청취</h1>
        <p className="text-neutral-400">
          배역별로 짝지어 듣고 어느 쪽이 실제 통화에 가까운지 고르세요. 정답표는 끝난 뒤에 봅니다.
          대조군(현행 목소리)은 <code>{CONTROL_HINT}</code> 에 있습니다.
        </p>
      </header>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} />
        <span>
          전화선 체인 통과 <span className="text-neutral-400">— 끄면 광대역 원본. 판단은 켠 상태로 하세요.</span>
        </span>
      </label>

      {error && <p className="rounded bg-amber-500/15 px-3 py-2 text-amber-300">{error}</p>}

      <ul className="flex flex-col gap-1">
        {clips.map((clip) => (
          <li key={clip.id}>
            <button
              onClick={() => (playing === clip.id ? stop() : play(clip))}
              className={`w-full rounded px-3 py-2 text-left font-mono ${
                playing === clip.id ? "bg-emerald-500/20 text-emerald-200" : "bg-neutral-800/60 hover:bg-neutral-700/60"
              }`}
            >
              {playing === clip.id ? "■" : "▶"} {clip.id}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
