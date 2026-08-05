import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireChild } from "@/lib/auth";
import { getScenario } from "@/lib/scenarios";
import {
  SEVERITY_BADGE_CLASSES,
  SEVERITY_LABELS,
  recurringTags,
  type TrainingReport,
} from "@/lib/report";
import LogoutButton from "@/components/logout-button";
import InvitePanel from "@/components/invite-panel";
import ParentCard from "@/components/parent-card";
import ParentTrend, { type TrendRound } from "@/components/parent-trend";
import NotificationList from "@/components/notification-list";
import RecoveryStatusCard from "@/components/recovery-status-card";
import LiveCallWatcher from "@/components/live-call-watcher";
import type { DamageMethod } from "@/lib/recovery";

export const metadata: Metadata = { title: "보호자 대시보드 · 백신콜" };

const dateTime = (d: Date) =>
  d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

export default async function DashboardPage() {
  const childId = await requireChild();

  const [child, reports, notifications, recoveryCases] = await Promise.all([
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
      take: 50,
      select: {
        id: true,
        parentId: true,
        scenarioId: true,
        source: true,
        report: true,
        createdAt: true,
        parent: { select: { name: true } },
      },
    }),
    prisma.notification.findMany({
      where: { childId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.recoveryCase.findMany({
      where: { parent: { childId } },
      orderBy: { createdAt: "desc" },
      include: { parent: { select: { name: true } } },
    }),
  ]);

  const now = new Date();

  // 회차 비교는 부모별로 따진다 (F1-5). 시나리오가 달라도 같은 흐름으로 본다.
  const trends = (child?.parents ?? [])
    .map((parent) => {
      const own = reports.filter((r) => r.parentId === parent.id).reverse(); // 오래된 회차부터
      return {
        id: parent.id,
        name: parent.name,
        rounds: own.map<TrendRound>((row) => {
          const report = row.report as unknown as TrainingReport;
          return {
            id: row.id,
            scenarioLabel: getScenario(row.scenarioId).label,
            overallRisk: report.overallRisk,
            riskMomentCount: report.riskMoments.length,
            dateLabel: row.createdAt.toLocaleDateString("ko-KR"),
          };
        }),
        recurring: recurringTags(own.map((row) => row.report as unknown as TrainingReport)),
      };
    })
    .filter((t) => t.rounds.length >= 2);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">보호자 대시보드</h1>
          <p className="mt-1 text-sm text-neutral-400">{child?.email}</p>
        </div>
        <LogoutButton />
      </header>

      {/* 지금 걸려오고 있는 전화보다 급한 것은 없다 (F3). 통화가 없으면 아무것도 그리지 않는다. */}
      <LiveCallWatcher />

      {/* 피해 구제가 진행 중이면 무엇보다 급한 소식이라 맨 위에 둔다 (F4). */}
      {recoveryCases.length > 0 && (
        <section className="space-y-2">
          {recoveryCases.map((row) => (
            <RecoveryStatusCard
              key={row.id}
              now={now}
              summary={{
                id: row.id,
                parentName: row.parent.name,
                method: row.method as DamageMethod,
                incidentAt: row.incidentAt,
                stepsDone: (row.stepsDone as string[]) ?? [],
                hasDocuments: row.documents !== null,
              }}
            />
          ))}
        </section>
      )}

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
                bank={parent.bank}
                family={parent.family}
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

      {trends.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">회차별 추이</h2>
          <ul className="space-y-2">
            {trends.map((trend) => (
              <ParentTrend
                key={trend.id}
                name={trend.name}
                rounds={trend.rounds}
                recurring={trend.recurring}
              />
            ))}
          </ul>
        </section>
      )}

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
                      {/* 훈련과 실제 의심 전화가 같은 목록에 섞인다. 실전은 눈에 띄어야 한다. */}
                      {row.source === "live" && (
                        <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                          실전
                        </span>
                      )}
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
