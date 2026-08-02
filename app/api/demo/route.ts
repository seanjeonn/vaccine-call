import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

export const runtime = "nodejs";

const DEMO_EMAIL = "demo-child@vaccinecall.demo";

// 심사위원용 원클릭 진입. 시드된 데모 계정의 세션을 바로 발급한다.
// 기존 세션이 있으면 덮어쓴다 — 부모/자녀 화면을 오가며 체험하라는 의도다.
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get("role");
  if (role !== "parent" && role !== "child") {
    return NextResponse.json({ error: "role은 parent 또는 child여야 합니다." }, { status: 400 });
  }

  const child = await prisma.child.findUnique({
    where: { email: DEMO_EMAIL },
    include: { parents: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  if (!child) {
    return NextResponse.json(
      { error: "데모 데이터가 없습니다. prisma/seed.mjs를 실행해 주세요." },
      { status: 503 },
    );
  }

  if (role === "child") {
    await createSession("child", child.id);
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const parent = child.parents[0];
  if (!parent) {
    return NextResponse.json(
      { error: "데모 부모가 없습니다. prisma/seed.mjs를 실행해 주세요." },
      { status: 503 },
    );
  }
  await createSession("parent", parent.id);
  return NextResponse.redirect(new URL("/p", req.url));
}
