import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireParent } from "@/lib/auth";
import {
  assistantContext,
  buildTimeline,
  type DamageMethod,
  type StepId,
} from "@/lib/recovery";
import RecoveryStart from "@/components/recovery-start";
import RecoveryChecklist from "@/components/recovery-checklist";
import RecoveryAssistant from "@/components/recovery-assistant";

export const metadata: Metadata = { title: "피해 구제 · 백신콜" };

// 피해구제 사무장 진입점(F4). 사건이 없으면 시작 문답, 있으면 골든타임 체크리스트.
export default async function RecoveryPage() {
  const parentId = await requireParent();
  const recoveryCase = await prisma.recoveryCase.findUnique({ where: { parentId } });
  const stepsDone = (recoveryCase?.stepsDone as StepId[]) ?? [];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 px-6 py-10">
      {recoveryCase ? (
        <>
          <RecoveryChecklist
            method={recoveryCase.method as DamageMethod}
            initialStepsDone={stepsDone}
            timeline={buildTimeline(
              recoveryCase.method as DamageMethod,
              recoveryCase.incidentAt,
              stepsDone,
              new Date(),
            )}
            hasDocuments={recoveryCase.documents !== null}
          />
          <RecoveryAssistant
            context={assistantContext(recoveryCase.method as DamageMethod, stepsDone)}
          />
        </>
      ) : (
        <RecoveryStart />
      )}

      <Link href="/p" className="text-center text-lg text-neutral-500 underline">
        처음 화면으로
      </Link>
    </main>
  );
}
