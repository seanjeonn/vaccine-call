// 실시간 통화 세션의 시작과 종료(F3). 분석 자체는 /api/copilot이 맡는다.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// 코파일럿은 자녀에게 알림을 보내는 것이 핵심이라 부모 세션이 없으면 시작할 수 없다.
// (체험 모드도 마찬가지다. 심사위원은 /api/demo?role=parent로 들어온다)
async function requireParentRecord() {
  const session = await getSession();
  if (session?.role !== "parent" || !session.parentId) return null;
  return prisma.parent.findUnique({ where: { id: session.parentId } });
}

export async function POST(req: NextRequest) {
  try {
    const parent = await requireParentRecord();
    if (!parent) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const { mode } = (await req.json()) as { mode?: string };
    if (mode !== "live" && mode !== "sim") {
      return NextResponse.json({ error: "통화 방식이 필요합니다." }, { status: 400 });
    }

    const call = await prisma.liveCall.create({
      data: { parentId: parent.id, mode },
      select: { id: true },
    });

    return NextResponse.json({ callId: call.id }, { status: 201 });
  } catch (err) {
    console.error("[copilot] start failed", err);
    return NextResponse.json({ error: "통화를 시작하지 못했습니다." }, { status: 500 });
  }
}

// 통화 종료. 리포트는 나중에 만들어지므로 클라이언트가 두 번 부른다
// (끊을 때 한 번, 리포트가 나오면 id를 붙이러 한 번).
export async function PATCH(req: NextRequest) {
  try {
    const parent = await requireParentRecord();
    if (!parent) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const { callId, reportId } = (await req.json()) as {
      callId?: string;
      reportId?: string;
    };
    if (typeof callId !== "string" || !callId) {
      return NextResponse.json({ error: "callId가 필요합니다." }, { status: 400 });
    }

    // 소유권은 where 절로 확인한다. 남의 통화면 count가 0이다.
    // 리포트를 붙이는 두 번째 호출에서는 endedAt을 건드리지 않는다. 분석에 걸린
    // 시간만큼 종료 시각이 뒤로 밀리면 자녀 화면의 "방금 끝난 통화"가 어긋난다.
    const { count } = await prisma.liveCall.updateMany({
      where: { id: callId, parentId: parent.id },
      data: reportId
        ? { reportId }
        : { status: "ended", endedAt: new Date() },
    });
    if (count === 0) {
      return NextResponse.json({ error: "통화를 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[copilot] end failed", err);
    return NextResponse.json({ error: "통화를 종료하지 못했습니다." }, { status: 500 });
  }
}
