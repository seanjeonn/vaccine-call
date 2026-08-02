import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import InviteAcceptForm from "@/components/invite-accept-form";

export const metadata: Metadata = { title: "초대받기 · 백신콜" };

// 부모가 카톡 등으로 받은 링크로 들어오는 화면. 가입도 설치도 없다.
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.invite.findUnique({ where: { token } });
  const valid = invite && !invite.usedAt && invite.expiresAt > new Date();

  if (!valid) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 px-6 text-center">
        <p className="text-3xl">🔗</p>
        <h1 className="text-2xl font-semibold">사용할 수 없는 초대 링크입니다</h1>
        <p className="text-lg leading-relaxed text-neutral-400">
          이미 사용했거나 기간이 지난 링크입니다.
          <br />
          자녀분께 새 링크를 요청해 주세요.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-bold leading-snug">
          자녀분이
          <br />
          백신콜에 초대했어요
        </h1>
        <p className="mt-3 text-lg leading-relaxed text-neutral-400">
          사기 전화를 미리 겪어보는 훈련입니다. 두 가지만 알려주시면 바로 시작합니다.
        </p>
      </header>

      <InviteAcceptForm token={token} />
    </main>
  );
}
