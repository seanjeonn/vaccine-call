import type { Metadata } from "next";
import { requireParent } from "@/lib/auth";
import CopilotClient from "@/components/copilot-client";

export const metadata: Metadata = { title: "의심 전화 · 백신콜" };

// 코파일럿은 자녀에게 알림을 보내는 것이 핵심이라 부모 세션이 있어야 한다.
export default async function CopilotPage() {
  await requireParent();
  return <CopilotClient />;
}
