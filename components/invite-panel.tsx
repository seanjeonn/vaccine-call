"use client";

import { useState } from "react";

// 초대 링크를 발급해 복사할 수 있게 한다. 링크는 1회용이라 부모마다 새로 발급한다.
export default function InvitePanel() {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function issue() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/invite", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "초대 링크를 만들지 못했습니다.");
      setUrl(data.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "초대 링크를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.");
    }
  }

  return (
    <div className="rounded-lg border border-neutral-800 p-4">
      <h3 className="text-sm font-semibold">부모님 초대하기</h3>
      <p className="mt-1 text-sm text-neutral-400">
        링크를 보내면 부모님은 이름만 입력하고 바로 시작할 수 있어요. 링크는 한 번만
        사용할 수 있고 7일 뒤 만료됩니다.
      </p>

      <button
        onClick={issue}
        disabled={busy}
        className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "만드는 중…" : url ? "새 링크 만들기" : "초대 링크 만들기"}
      </button>

      {url && (
        <div className="mt-3 flex flex-col gap-2">
          <code className="break-all rounded bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
            {url}
          </code>
          <button
            onClick={copy}
            className="self-start rounded border border-neutral-600 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            {copied ? "복사했습니다" : "링크 복사"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
