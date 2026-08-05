// 자녀 대시보드가 폴링으로 읽는 실시간 통화 현황(F3-3).
// 서버리스라 연결을 물고 있을 수 없어 SSE 대신 짧은 조회를 되풀이한다.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// 끝난 통화도 잠깐은 보여준다. 자녀가 알림을 보고 들어왔을 때 이미 끊긴 통화라도
// 무슨 일이 있었는지는 알아야 한다.
const RECENT_MS = 30 * 60 * 1000;

export async function GET() {
  try {
    const session = await getSession();
    if (session?.role !== "child" || !session.childId) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const calls = await prisma.liveCall.findMany({
      where: {
        parent: { childId: session.childId },
        OR: [
          { status: "active" },
          { endedAt: { gte: new Date(Date.now() - RECENT_MS) } },
        ],
      },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        mode: true,
        stage: true,
        risk: true,
        scamType: true,
        summary: true,
        reportId: true,
        startedAt: true,
        parent: { select: { name: true } },
      },
    });

    return NextResponse.json({
      calls: calls.map((c) => ({
        id: c.id,
        parentName: c.parent.name,
        status: c.status,
        mode: c.mode,
        stage: c.stage,
        risk: c.risk,
        scamType: c.scamType,
        summary: c.summary,
        reportId: c.reportId,
        startedAt: c.startedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[copilot] live fetch failed", err);
    return NextResponse.json({ error: "현황을 읽지 못했습니다." }, { status: 500 });
  }
}
