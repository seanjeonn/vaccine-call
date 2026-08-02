import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireChild } from "@/lib/auth";
import { getScenario } from "@/lib/scenarios";
import { SEVERITY_BADGE_CLASSES, SEVERITY_LABELS, type TrainingReport } from "@/lib/report";
import LogoutButton from "@/components/logout-button";
import InvitePanel from "@/components/invite-panel";
import ParentCard from "@/components/parent-card";
import NotificationList from "@/components/notification-list";

export const metadata: Metadata = { title: "보호자 대시보드 · 백신콜" };

const dateTime = (d: Date) =>
  d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export default async function DashboardPage() {
  const childId = await requireChild();

  const [child, reports, notifications] = await Promise.all([
    prisma.child.findUnique({
      where: { id: childId },
      include: {
        parents: {
          orderBy: { createdAt: "asc" },
          include: {
            reports: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
            _count: { select: { reports: true } },
          },
        },
      },
    }),
    prisma.report.findMany({
      where: { parent: { childId } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { parent: { select: { name: true } } },
    }),
    prisma.notification.findMany({
      where: { childId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">보호자 대시보드</h1>
          <p className="mt-1 text-sm text-neutral-400">{child?.email}</p>
        </div>
        <LogoutButton />
      </header>

      <NotificationList
        items={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          reportId: n.reportId,
          createdAt: dateTime(n.createdAt),
          unread: n.readAt === null,
        }))}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">부모님</h2>
        {child && child.parents.length > 0 ? (
          <ul className="space-y-2">
            {child.parents.map((parent) => (
              <ParentCard
                key={parent.id}
                id={parent.id}
                name={parent.name}
                ageGroup={parent.ageGroup}
                reportCount={parent._count.reports}
                lastTrainedAt={
                  parent.reports[0]
                    ? parent.reports[0].createdAt.toLocaleDateString("ko-KR")
                    : null
                }
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            아직 등록된 부모님이 없습니다. 아래에서 초대 링크를 보내주세요.
          </p>
        )}
      </section>

      <InvitePanel />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-300">훈련 기록</h2>
        {reports.length === 0 ? (
          <p className="rounded-lg border border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            아직 훈련 기록이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {reports.map((row) => {
              const report = row.report as unknown as TrainingReport;
              return (
                <li key={row.id}>
                  <Link
                    href={`/dashboard/reports/${row.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-neutral-800 px-4 py-3 transition hover:border-neutral-600"
                  >
                    <div>
                      <span className="text-sm font-medium">{row.parent.name}</span>
                      <span className="ml-2 text-xs text-neutral-400">
                        {getScenario(row.scenarioId).label}
                      </span>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {dateTime(row.createdAt)}
                      </p>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded px-2 py-0.5 text-[11px] font-medium " +
                        SEVERITY_BADGE_CLASSES[report.overallRisk]
                      }
                    >
                      위험도 {SEVERITY_LABELS[report.overallRisk]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
