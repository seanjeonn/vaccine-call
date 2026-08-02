import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireChild } from "@/lib/auth";
import LogoutButton from "@/components/logout-button";
import InvitePanel from "@/components/invite-panel";

export const metadata: Metadata = { title: "보호자 대시보드 · 백신콜" };

export default async function DashboardPage() {
  const childId = await requireChild();
  const child = await prisma.child.findUnique({
    where: { id: childId },
    include: { parents: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">보호자 대시보드</h1>
          <p className="mt-1 text-sm text-neutral-400">{child?.email}</p>
        </div>
        <LogoutButton />
      </header>

      <InvitePanel />

      <section>
        <h2 className="text-sm font-semibold text-neutral-300">등록된 부모님</h2>
        {child && child.parents.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {child.parents.map((parent) => (
              <li key={parent.id} className="rounded-lg border border-neutral-800 px-4 py-3">
                <span className="font-medium">{parent.name}</span>
                <span className="ml-2 text-sm text-neutral-400">{parent.ageGroup}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg border border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
            아직 등록된 부모님이 없습니다.
          </p>
        )}
      </section>
    </main>
  );
}
