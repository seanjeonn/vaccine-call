import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// 부모 초대 링크를 발급한다. 토큰은 1회용이며, 다시 부르면 새 토큰이 나온다.
export async function POST() {
  try {
    const session = await getSession();
    if (session?.role !== "child" || !session.childId) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const invite = await prisma.invite.create({
      data: {
        token: randomBytes(24).toString("hex"),
        childId: session.childId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    // 배포 도메인이 여러 개일 수 있어 요청 호스트를 그대로 쓴다.
    const h = await headers();
    const host = h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

    return NextResponse.json({
      url: `${proto}://${host}/invite/${invite.token}`,
      expiresAt: invite.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[invite] error", err);
    return NextResponse.json({ error: "초대 링크를 만들지 못했습니다." }, { status: 500 });
  }
}
