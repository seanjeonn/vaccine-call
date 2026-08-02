// 부모 프로필 입력값. DB enum 대신 문자열로 저장하고 여기서 단일 관리한다.

export const AGE_GROUPS = ["60대", "70대", "80대 이상"] as const;

export type AgeGroup = (typeof AGE_GROUPS)[number];

export function isAgeGroup(value: unknown): value is AgeGroup {
  return typeof value === "string" && (AGE_GROUPS as readonly string[]).includes(value);
}

// 호칭은 화면에 그대로 노출되므로 길이만 제한한다.
export function normalizeParentName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.length > 20) return null;
  return name;
}
