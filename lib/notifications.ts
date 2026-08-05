// 자녀 알림함에 한 건을 남긴다. 호출부가 넷으로 늘어나면서 종류 값과
// 실패 처리 방식을 한곳에서 관리하려고 뺐다.

import { prisma } from "@/lib/db";

// notification-list.tsx는 "risk"만 붉은 뱃지로 구분한다. 나머지는 일반 카드다.
export type NotificationType =
  | "report" // 훈련이 끝났다는 소식
  | "risk" // 지금 위험하다는 소식 (훈련 위험 신호·의심 전화·피해 구제 시작)
  | "recovery"; // 피해구제 절차 진행 소식

export type NotificationInput = {
  type: NotificationType;
  title: string;
  body: string;
  reportId?: string; // 있으면 알림 카드가 리포트 상세로 이어진다
};

export async function notifyChild(
  childId: string,
  input: NotificationInput,
): Promise<void> {
  await prisma.notification.create({
    data: {
      childId,
      reportId: input.reportId,
      type: input.type,
      title: input.title,
      body: input.body,
    },
  });
}
