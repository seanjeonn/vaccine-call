import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, hashPassword } from "@/lib/auth";

export const runtime = "nodejs";

// 자녀(보호자) 가입. 부모는 가입하지 않고 초대 링크로만 연결된다.
export async function POST(req: NextRequest) {
  try {
    const { email, password } = (await req.json()) as {
      email?: string;
      password?: string;
    };

    const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!normalized.includes("@") || normalized.length > 200) {
      return NextResponse.json({ error: "이메일 주소를 확인해 주세요." }, { status: 400 });
    }
    if (typeof password !== "string" || password.length < 8) {
      return NextResponse.json(
        { error: "비밀번호는 8자 이상이어야 합니다." },
        { status: 400 },
      );
    }

    const existing = await prisma.child.findUnique({ where: { email: normalized } });
    if (existing) {
      return NextResponse.json({ error: "이미 가입된 이메일입니다." }, { status: 409 });
    }

    const child = await prisma.child.create({
      data: { email: normalized, passwordHash: await hashPassword(password) },
    });
    await createSession("child", child.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[signup] error", err);
    return NextResponse.json({ error: "가입에 실패했습니다." }, { status: 500 });
  }
}
