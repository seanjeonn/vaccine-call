"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InterviewAnswers, InterviewQuestion, QuestionId } from "@/lib/recovery";

type Followup = { question: string; answer: string };

// 서류 문답(F4-2). 정해진 질문을 하나씩 묻고, 사무장이 사실이 모자라다고 판단하면
// 마지막에 최대 2개를 되묻는다. 채팅처럼 보이지만 흐름은 정해져 있어 길을 잃지 않는다.
export default function RecoveryInterview({
  questions,
  initialAnswers,
}: {
  questions: InterviewQuestion[];
  initialAnswers: InterviewAnswers | null;
}) {
  const router = useRouter();
  const [answers, setAnswers] = useState<InterviewAnswers>(initialAnswers ?? {});
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [followups, setFollowups] = useState<Followup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const question = questions[index];
  const answered = questions.slice(0, index);

  async function generate(next: InterviewAnswers) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recovery/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "서류를 만들지 못했습니다.");

      if (Array.isArray(data?.followups) && data.followups.length > 0) {
        setFollowups(data.followups.map((q: string) => ({ question: q, answer: "" })));
        setBusy(false);
        return;
      }

      router.push("/p/recovery/print");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "서류를 만들지 못했습니다.");
      setBusy(false);
    }
  }

  function submitAnswer(value: string) {
    const next = { ...answers, [question.id as QuestionId]: value };
    setAnswers(next);
    setDraft("");
    if (index + 1 < questions.length) {
      setIndex(index + 1);
    } else {
      void generate(next);
    }
  }

  if (busy) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-neutral-700 border-t-emerald-500" />
        <p className="text-2xl font-bold">서류를 만들고 있어요</p>
        <p className="text-xl text-neutral-400">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  // 되묻기 단계. 사무장이 물어본 것에 답하면 바로 서류를 만든다.
  if (followups) {
    const remaining = followups.find((f) => !f.answer.trim());
    return (
      <div className="flex flex-col gap-6">
        <Bubble>몇 가지만 더 여쭐게요.</Bubble>
        {followups.map((f) =>
          f.answer.trim() ? (
            <div key={f.question} className="flex flex-col gap-2">
              <Bubble>{f.question}</Bubble>
              <Answer>{f.answer}</Answer>
            </div>
          ) : null,
        )}

        {remaining && (
          <>
            <Bubble>{remaining.question}</Bubble>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              className="rounded-2xl border-2 border-neutral-600 bg-neutral-900 px-4 py-4 text-xl leading-relaxed"
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                const next = followups.map((f) =>
                  f.question === remaining.question ? { ...f, answer: draft.trim() } : f,
                );
                setFollowups(next);
                setDraft("");
                if (next.every((f) => f.answer.trim())) {
                  void generate({ ...answers, followups: next });
                }
              }}
              className="rounded-full bg-emerald-600 py-5 text-2xl font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              답했어요
            </button>
            <button
              type="button"
              onClick={() => void generate({ ...answers, followups })}
              className="text-lg text-neutral-500 underline"
            >
              잘 모르겠어요, 그냥 만들어 주세요
            </button>
          </>
        )}

        {error && (
          <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Bubble>
        은행에 낼 서류를 만들어 드릴게요. 기억나는 대로만 답해주시면 됩니다.
      </Bubble>

      {answered.map((q) => (
        <div key={q.id} className="flex flex-col gap-2">
          <Bubble>{q.prompt}</Bubble>
          <Answer>{answers[q.id] || "모르겠어요"}</Answer>
        </div>
      ))}

      <Bubble>{question.prompt}</Bubble>

      {question.kind === "choice" ? (
        <div className="flex flex-col gap-2">
          {question.choices?.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => submitAnswer(choice)}
              className="rounded-2xl border-2 border-neutral-700 px-5 py-5 text-left text-xl font-bold transition hover:border-neutral-500"
            >
              {choice}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {question.kind === "number" ? (
            <div className="flex items-center gap-3">
              <input
                type="number"
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={question.placeholder}
                className="min-w-0 flex-1 rounded-2xl border-2 border-neutral-600 bg-neutral-900 px-4 py-4 text-2xl"
              />
              <span className="shrink-0 text-2xl font-bold">만원</span>
            </div>
          ) : question.id === "story" ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              placeholder={question.placeholder}
              className="rounded-2xl border-2 border-neutral-600 bg-neutral-900 px-4 py-4 text-xl leading-relaxed"
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={question.placeholder}
              className="rounded-2xl border-2 border-neutral-600 bg-neutral-900 px-4 py-4 text-2xl"
            />
          )}

          <button
            type="button"
            disabled={!draft.trim()}
            onClick={() => submitAnswer(draft.trim())}
            className="rounded-full bg-emerald-600 py-5 text-2xl font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            다음
          </button>
          {question.optional && (
            <button
              type="button"
              onClick={() => submitAnswer("")}
              className="text-lg text-neutral-500 underline"
            >
              기억이 안 나요, 넘어갈게요
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-red-500/15 px-4 py-3 text-lg text-red-300">{error}</p>
      )}
    </div>
  );
}

const Bubble = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-2xl bg-neutral-900 px-5 py-4 text-xl leading-relaxed">{children}</p>
);

const Answer = ({ children }: { children: React.ReactNode }) => (
  <p className="ml-8 rounded-2xl bg-sky-600 px-5 py-4 text-xl leading-relaxed text-white">
    {children}
  </p>
);
