import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const COOKIE_NAME = "vc_session";

// 자녀는 비밀번호로 다시 들어올 수 있지만, 부모는 재진입 수단이 초대 링크뿐이라 길게 잡는다.
const CHILD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PARENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type SessionRole = "child" | "parent";

export type Session = {
  token: string;
  role: SessionRole;
  childId: string | null;
  parentId: string | null;
};

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const key = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== key.length) return false;
  return timingSafeEqual(key, expected);
}

// 세션을 만들고 쿠키를 심는다. 기존 세션이 있으면 덮어쓴다(초대 수락·데모 전환).
export async function createSession(role: SessionRole, id: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (role === "child" ? CHILD_TTL_MS : PARENT_TTL_MS));

  await prisma.session.create({
    data: {
      token,
      role,
      childId: role === "child" ? id : null,
      parentId: role === "parent" ? id : null,
      expiresAt,
    },
  });

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax", // 카톡 등 외부에서 초대 링크로 들어와도 쿠키가 붙어야 한다
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;

  return {
    token: session.token,
    role: session.role as SessionRole,
    childId: session.childId,
    parentId: session.parentId,
  };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  jar.delete(COOKIE_NAME);
}

// 보호된 화면에서 호출한다. 역할이 맞지 않으면 되돌려 보낸다.
export async function requireChild(): Promise<string> {
  const session = await getSession();
  if (session?.role !== "child" || !session.childId) redirect("/login");
  return session.childId;
}

export async function requireParent(): Promise<string> {
  const session = await getSession();
  if (session?.role !== "parent" || !session.parentId) redirect("/");
  return session.parentId;
}
