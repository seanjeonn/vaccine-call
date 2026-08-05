import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { isAgeGroup, normalizeParentName } from "@/lib/parent";

export const runtime = "nodejs";

// 초대를 수락해 부모를 만들고 부모 세션을 발급한다.
export async function POST(req: NextRequest) {
  try {
    const { token, name, ageGroup } = (await req.json()) as {
      token?: string;
      name?: string;
      ageGroup?: string;
    };

    const parentName = normalizeParentName(name);
    if (!token || !parentName || !isAgeGroup(ageGroup)) {
      return NextResponse.json({ error: "입력을 확인해 주세요." }, { status: 400 });
    }

    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "만료되었거나 잘못된 초대 링크입니다." },
        { status: 404 },
      );
    }

    // 링크를 두 번 눌러도 부모가 둘 생기지 않도록, 미사용 상태일 때만 선점한다.
    const claimed = await prisma.invite.updateMany({
      where: { token, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      return NextResponse.json({ error: "이미 사용된 초대 링크입니다." }, { status: 409 });
    }

    const parent = await prisma.parent.create({
      data: { childId: invite.childId, name: parentName, ageGroup },
    });
    await createSession("parent", parent.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[invite/accept] error", err);
    return NextResponse.json({ error: "연결에 실패했습니다." }, { status: 500 });
  }
}
