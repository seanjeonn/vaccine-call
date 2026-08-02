import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// 알림함을 통째로 읽음 처리한다. 개별 읽음은 아직 필요하지 않다.
export async function POST() {
  const session = await getSession();
  if (session?.role !== "child" || !session.childId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  await prisma.notification.updateMany({
    where: { childId: session.childId, readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
