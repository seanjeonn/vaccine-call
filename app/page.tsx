import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// 랜딩. 이미 로그인한 사람은 자기 화면으로 곧장 보낸다.
export default async function LandingPage() {
  const session = await getSession();
  if (session?.role === "child") redirect("/dashboard");
  if (session?.role === "parent") redirect("/p");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <section>
        <h1 className="text-4xl font-bold tracking-tight">백신콜</h1>
        <p className="mt-2 text-lg text-neutral-300">사기 전화, 미리 맞는 예방주사</p>
        <p className="mt-4 leading-relaxed text-neutral-400">
          AI가 사기꾼을 연기해 부모님께 모의 훈련 전화를 겁니다. 훈련이 끝나면 어느 순간이
          위험했는지 분석해 드리고, 그 결과를 자녀에게 공유합니다.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <Link
          href="/signup"
          className="rounded-full bg-emerald-600 py-4 text-center text-base font-semibold text-white transition hover:bg-emerald-500"
        >
          보호자로 시작하기
        </Link>
        <Link
          href="/login"
          className="rounded-full border border-neutral-700 py-4 text-center text-base font-semibold transition hover:bg-neutral-800"
        >
          로그인
        </Link>
        <Link
          href="/call"
          className="py-2 text-center text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-200"
        >
          가입 없이 훈련 체험해보기
        </Link>
      </section>

      <section className="rounded-xl border border-neutral-800 p-4">
        <h2 className="text-sm font-semibold text-neutral-300">이렇게 씁니다</h2>
        <ol className="mt-2 space-y-1.5 text-sm leading-relaxed text-neutral-400">
          <li>1. 자녀가 가입하고 부모님께 초대 링크를 보냅니다.</li>
          <li>2. 부모님은 링크를 열어 이름만 입력하면 됩니다. 설치도 가입도 없습니다.</li>
          <li>3. 부모님이 훈련을 마치면 자녀에게 결과가 도착합니다.</li>
        </ol>
      </section>
    </main>
  );
}
