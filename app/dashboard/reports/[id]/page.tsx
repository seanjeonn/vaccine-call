import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireChild } from "@/lib/auth";
import { getScenario } from "@/lib/scenarios";
import type { TrainingReport } from "@/lib/report";
import TrainingReportView from "@/components/training-report";

export const metadata: Metadata = { title: "훈련 리포트 · 백신콜" };

type Message = { role: "user" | "assistant"; content: string };

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const childId = await requireChild();
  const { id } = await params;

  // 소유권을 조건에 넣어 남의 리포트가 열리지 않게 한다.
  const row = await prisma.report.findFirst({
    where: { id, parent: { childId } },
    include: { parent: { select: { name: true } } },
  });
  if (!row) notFound();

  const report = row.report as unknown as TrainingReport;
  const messages = row.messages as unknown as Message[];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-6 py-10">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
        >
          ← 대시보드
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {row.parent.name}님의 훈련 리포트
        </h1>
        <p className="text-sm text-neutral-500">
          {row.createdAt.toLocaleString("ko-KR", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl bg-neutral-950">
        <TrainingReportView
          report={report}
          messages={messages}
          scenarioLabel={getScenario(row.scenarioId).label}
        />
      </div>
    </main>
  );
}
