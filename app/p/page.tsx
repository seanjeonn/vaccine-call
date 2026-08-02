import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireParent } from "@/lib/auth";
import { compareRisk, type TrainingReport } from "@/lib/report";

export const metadata: Metadata = { title: "백신콜" };

// 부모 홈. 고령자 기준 — 큰 글씨, 누를 것 하나.
export default async function ParentHomePage() {
  const parentId = await requireParent();
  const parent = await prisma.parent.findUnique({
    where: { id: parentId },
    include: {
      reports: {
        orderBy: { createdAt: "desc" },
        take: 2,
        select: { createdAt: true, report: true },
      },
      _count: { select: { reports: true } },
    },
  });

  const last = parent?.reports[0];
  const previous = parent?.reports[1];
  // 부모 화면에는 숫자를 늘어놓지 않는다. 좋아졌을 때만 한 줄 칭찬한다 (F1-5).
  const improved =
    last &&
    previous &&
    compareRisk(
      (previous.report as unknown as TrainingReport).overallRisk,
      (last.report as unknown as TrainingReport).overallRisk,
    ) === "improved";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-10 px-6 py-12">
      <header>
        <h1 className="text-3xl font-bold leading-snug">
          {parent?.name}님,
          <br />
          안녕하세요
        </h1>
        <p className="mt-3 text-xl leading-relaxed text-neutral-400">
          사기 전화가 오면 어떻게 하실지, 미리 연습해 보세요.
        </p>
      </header>

      <Link
        href="/call"
        className="rounded-full bg-emerald-600 py-8 text-center text-3xl font-bold text-white transition hover:bg-emerald-500"
      >
        훈련 시작하기
      </Link>

      {improved && (
        <p className="text-center text-2xl font-bold leading-relaxed text-emerald-400">
          지난번보다 잘 대응하셨어요!
        </p>
      )}

      <p className="text-center text-lg text-neutral-500">
        {last
          ? `지금까지 ${parent?._count.reports}번 훈련하셨어요 · 마지막 ${last.createdAt.toLocaleDateString("ko-KR")}`
          : "아직 훈련한 적이 없어요."}
      </p>
    </main>
  );
}
