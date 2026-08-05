"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  type: string;
  title: string;
  body: string;
  reportId: string | null;
  createdAt: string;
  unread: boolean;
};

export default function NotificationList({ items }: { items: Item[] }) {
  const router = useRouter();
  const unreadCount = items.filter((i) => i.unread).length;

  async function markAllRead() {
    await fetch("/api/notifications/read", { method: "POST" });
    router.refresh();
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">
          알림
          {unreadCount > 0 && (
            <span className="ml-2 rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
              {unreadCount}
            </span>
          )}
        </h2>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
          >
            모두 읽음
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 px-4 py-6 text-center text-sm text-neutral-500">
          아직 알림이 없습니다.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const risky = item.type === "risk";
            const card = (
              <div
                className={
                  "rounded-lg border px-4 py-3 " +
                  (item.unread ? "border-neutral-600 bg-neutral-900" : "border-neutral-800")
                }
              >
                <div className="flex items-center gap-2">
                  {risky && (
                    <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                      위험
                    </span>
                  )}
                  <span className={item.unread ? "text-sm font-semibold" : "text-sm"}>
                    {item.title}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-neutral-400">{item.body}</p>
                <p className="mt-1 text-xs text-neutral-500">{item.createdAt}</p>
              </div>
            );

            return (
              <li key={item.id}>
                {item.reportId ? (
                  <Link href={`/dashboard/reports/${item.reportId}`} className="block">
                    {card}
                  </Link>
                ) : (
                  card
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
