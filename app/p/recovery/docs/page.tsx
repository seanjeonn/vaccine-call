import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireParent } from "@/lib/auth";
import {
  assistantContext,
  questionsFor,
  type DamageMethod,
  type InterviewAnswers,
  type StepId,
} from "@/lib/recovery";
import RecoveryInterview from "@/components/recovery-interview";
import RecoveryAssistant from "@/components/recovery-assistant";

export const metadata: Metadata = { title: "서류 만들기 · 백신콜" };

// 서류 문답(F4-2). 이미 만들어 둔 초안이 있으면 인쇄 화면으로 보낸다.
export default async function RecoveryDocsPage({
  searchParams,
}: {
  searchParams: Promise<{ again?: string }>;
}) {
  const parentId = await requireParent();
  const recoveryCase = await prisma.recoveryCase.findUnique({ where: { parentId } });
  if (!recoveryCase) redirect("/p/recovery");

  const { again } = await searchParams;
  if (recoveryCase.documents && !again) redirect("/p/recovery/print");

  const method = recoveryCase.method as DamageMethod;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 px-6 py-10">
      <RecoveryInterview
        questions={questionsFor(method)}
        initialAnswers={recoveryCase.answers as InterviewAnswers | null}
      />

      <RecoveryAssistant
        context={assistantContext(method, (recoveryCase.stepsDone as StepId[]) ?? [])}
      />

      <Link href="/p/recovery" className="text-center text-lg text-neutral-500 underline">
        체크리스트로 돌아가기
      </Link>
    </main>
  );
}
