import { PrismaClient } from "@prisma/client";

// 개발 중 HMR로 커넥션이 계속 늘어나는 것을 막기 위한 싱글턴.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
