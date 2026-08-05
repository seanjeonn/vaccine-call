"use client";

// 자녀 대시보드 맨 위의 실시간 통화 현황(F3-3). 부모가 의심 전화를 받는 동안
// 단계와 위험도가 여기서 갱신된다.
//
// 대시보드는 서버에서 한 번 그려지고 끝이라 스스로 새로고침하지 않는다. 서버리스에서는
// 연결을 물고 있을 수 없어 SSE 대신 5초마다 짧게 물어본다 — 인덱스 하나짜리 조회다.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getScenario } from "@/lib/scenarios";
import { SEVERITY_BADGE_CLASSES, SEVERITY_LABELS } from "@/lib/report";
import {
  COPILOT_STAGES,
  STAGE_LABELS,
  riskLevel,
  stageRank,
  type CopilotStage,
} from "@/lib/copilot";

type LiveCall = {
  id: string;
  parentName: string;
  status: string;
  mode: string;
  stage: CopilotStage;
  risk: number;
  scamType: string;
  summary: string;
  reportId: string | null;
  startedAt: string;
};

const POLL_MS = 5000;

export default function LiveCallWatcher() {
  const [calls, setCalls] = useState<LiveCall[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/copilot/live");
      if (!res.ok) return;
      const data = (await res.json()) as { calls: LiveCall[] };
      setCalls(data.calls);
    } catch {
      // 폴링 실패는 다음 주기에 저절로 만회된다.
    }
  }, []);

  useEffect(() => {
    // 보고 있지 않은 화면을 위해서는 묻지 않고, 탭으로 돌아오면 주기를 기다리지 않는다.
    const tick = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    // 첫 조회도 타이머로 미룬다. 이펙트 본문에서 바로 상태를 건드리면 렌더가 연쇄된다.
    const kick = window.setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(kick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  if (calls.length === 0) return null;

  return (
    <section className="space-y-2">
      {calls.map((call) => {
        const active = call.status === "active";
        const level = riskLevel(call.risk);
        const typeLabel =
          call.scamType === "unknown" ? null : getScenario(call.scamType).label;

        return (
          <div
            key={call.id}
            className={
              "rounded-lg border px-4 py-4 " +
              (active
                ? "border-red-500/60 bg-red-500/10"
                : "border-neutral-800 bg-neutral-900/40")
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              {active && <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />}
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10px] font-medium " +
                  (active ? "bg-red-500/15 text-red-300" : "bg-neutral-800 text-neutral-400")
                }
              >
                {active ? "의심 전화 분석 중" : "통화 종료됨"}
              </span>
              <span className="text-sm font-semibold">{call.parentName}님</span>
              {call.mode === "sim" && (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                  체험
                </span>
              )}
              <span
                className={
                  "ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " +
                  SEVERITY_BADGE_CLASSES[level]
                }
              >
                위험도 {SEVERITY_LABELS[level]}
              </span>
            </div>

            {active && (
              <p className="mt-2 text-base font-semibold text-red-300">
                지금 {call.parentName}님이 의심 전화를 받고 있어요. 바로 전화해 주세요.
              </p>
            )}

            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              {call.summary || "통화 내용을 분석하고 있습니다."}
            </p>

            <div className="mt-3 flex gap-1">
              {COPILOT_STAGES.map((s) => (
                <div key={s} className="flex-1 text-center">
                  <div
                    className={
                      "h-1.5 rounded-full " +
                      (stageRank(call.stage) >= stageRank(s)
                        ? "bg-red-500"
                        : "bg-neutral-700")
                    }
                  />
                  <span className="mt-1 block text-[10px] text-neutral-500">
                    {STAGE_LABELS[s]}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-2 text-xs text-neutral-500">
              {typeLabel ? `${typeLabel} 의심 · ` : ""}
              {new Date(call.startedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              시작
            </p>

            {call.reportId && (
              <Link
                href={`/dashboard/reports/${call.reportId}`}
                className="mt-2 inline-block text-sm text-neutral-300 underline"
              >
                통화 분석 리포트 보기
              </Link>
            )}
          </div>
        );
      })}
    </section>
  );
}
