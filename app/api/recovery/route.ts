import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notifyChild } from "@/lib/notifications";
import { isDamageMethod, isStepId, type DamageMethod } from "@/lib/recovery";

export const runtime = "nodejs";

// 부모 세션 + 사건은 화면 진입 조건이라, 리포트 라우트와 달리 여기서는 조용히 넘기지 않고 막는다.
async function requireParentRecord() {
  const session = await getSession();
  if (session?.role !== "parent" || !session.parentId) return null;
  return prisma.parent.findUnique({ where: { id: session.parentId } });
}

// 사건 시작. 이미 있으면 덮어쓴다 — 부모당 한 건이라 "다시 시작"이 곧 갱신이다.
export async function POST(req: NextRequest) {
  try {
    const parent = await requireParentRecord();
    if (!parent) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const { method, daysAgo } = (await req.json()) as {
      method?: string;
      daysAgo?: number;
    };

    if (!isDamageMethod(method)) {
      return NextResponse.json({ error: "피해 유형이 필요합니다." }, { status: 400 });
    }

    // 부모에게 정확한 시각을 묻는 것은 무리라 "며칠 전"만 받는다. 기한 계산은 날짜 단위다.
    if (typeof daysAgo !== "number" || !Number.isInteger(daysAgo) || daysAgo < 0 || daysAgo > 30) {
      return NextResponse.json({ error: "피해 시점이 필요합니다." }, { status: 400 });
    }
    const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

    const existing = await prisma.recoveryCase.findUnique({
      where: { parentId: parent.id },
      select: { id: true },
    });

    // 다시 시작하면 이전 사건의 진행과 서류는 버린다.
    // Json 컬럼을 비우려면 undefined(=변경 없음)가 아니라 DbNull을 써야 한다.
    await prisma.recoveryCase.upsert({
      where: { parentId: parent.id },
      update: {
        method,
        incidentAt: when,
        stepsDone: [],
        answers: Prisma.DbNull,
        documents: Prisma.DbNull,
      },
      create: { parentId: parent.id, method, incidentAt: when },
    });

    // 자녀에게는 시작 시점에 한 번만 알린다. 단계별 진행은 대시보드 카드가 보여준다.
    if (!existing) {
      await notifyChild(parent.childId, {
        type: "risk",
        title: `${parent.name}님이 보이스피싱 피해 구제를 시작했어요`,
        body: "골든타임 절차를 진행 중입니다. 지금 바로 전화해 확인해 주세요.",
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recovery] create failed", err);
    return NextResponse.json({ error: "사건을 시작하지 못했습니다." }, { status: 500 });
  }
}

// 체크리스트 단계 완료 표시 토글.
export async function PATCH(req: NextRequest) {
  try {
    const parent = await requireParentRecord();
    if (!parent) {
      return NextResponse.json({ error: "부모 계정으로 로그인해 주세요." }, { status: 401 });
    }

    const recoveryCase = await prisma.recoveryCase.findUnique({
      where: { parentId: parent.id },
    });
    if (!recoveryCase) {
      return NextResponse.json({ error: "진행 중인 사건이 없습니다." }, { status: 404 });
    }

    const { stepId, done } = (await req.json()) as { stepId?: string; done?: boolean };
    const method = recoveryCase.method as DamageMethod;
    if (!isStepId(method, stepId)) {
      return NextResponse.json({ error: "알 수 없는 단계입니다." }, { status: 400 });
    }

    const current = (recoveryCase.stepsDone as string[]) ?? [];
    const stepsDone = done
      ? [...new Set([...current, stepId])]
      : current.filter((id) => id !== stepId);

    await prisma.recoveryCase.update({
      where: { parentId: parent.id },
      data: { stepsDone },
    });

    return NextResponse.json({ stepsDone });
  } catch (err) {
    console.error("[recovery] update failed", err);
    return NextResponse.json({ error: "저장하지 못했습니다." }, { status: 500 });
  }
}
