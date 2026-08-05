"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-emerald-600 py-6 text-2xl font-bold text-white transition hover:bg-emerald-500"
    >
      🖨 인쇄하기 (PDF로 저장)
    </button>
  );
}
