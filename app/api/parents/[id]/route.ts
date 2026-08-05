import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import {
  isAgeGroup,
  normalizeBank,
  normalizeFamily,
  normalizeParentName,
} from "@/lib/parent";

export const runtime = "nodejs";

// 자녀가 부모 프로필을 고친다 (F2-4).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (session?.role !== "child" || !session.childId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const { name, ageGroup, bank, family } = (await req.json()) as {
    name?: string;
    ageGroup?: string;
    bank?: string;
    family?: string;
  };

  const parentName = normalizeParentName(name);
  if (!parentName || !isAgeGroup(ageGroup)) {
    return NextResponse.json({ error: "입력을 확인해 주세요." }, { status: 400 });
  }

  // 남의 부모를 고치지 못하도록 소유권을 조건에 넣는다.
  const updated = await prisma.parent.updateMany({
    where: { id, childId: session.childId },
    // 은행·가족 구성은 선택 항목이라 미선택이면 null로 지운다 (F1-1).
    data: {
      name: parentName,
      ageGroup,
      bank: normalizeBank(bank),
      family: normalizeFamily(family),
    },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
