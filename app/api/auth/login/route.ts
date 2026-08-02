import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, verifyPassword } from "@/lib/auth";

export const runtime = "nodejs";

// 계정 존재 여부를 흘리지 않도록 실패 메시지를 하나로 통일한다.
const FAILED = "이메일 또는 비밀번호가 올바르지 않습니다.";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };

    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized || typeof password !== "string" || !password) {
      return NextResponse.json({ error: FAILED }, { status: 401 });
    }

    const child = await prisma.child.findUnique({ where: { email: normalized } });
    if (!child || !(await verifyPassword(password, child.passwordHash))) {
      return NextResponse.json({ error: FAILED }, { status: 401 });
    }

    await createSession("child", child.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[login] error", err);
    return NextResponse.json({ error: "로그인에 실패했습니다." }, { status: 500 });
  }
}
