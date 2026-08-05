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

// 맞춤 시나리오 생성에 쓰는 선택 항목(F1-1). 자녀가 대신 골라주고, 비워둬도 된다.
// 실명·계좌번호는 여전히 받지 않는다 (PRD §5).

export const BANKS = [
  "KB국민은행",
  "신한은행",
  "우리은행",
  "하나은행",
  "NH농협은행",
  "IBK기업은행",
  "새마을금고",
  "우체국",
  "카카오뱅크",
] as const;

export const FAMILY_OPTIONS = ["아들", "딸", "아들과 딸", "해당 없음"] as const;

export type Bank = (typeof BANKS)[number];
export type FamilyOption = (typeof FAMILY_OPTIONS)[number];

// 필수가 아니므로 목록에 없는 값은 거절이 아니라 "미선택"(null)으로 본다.
export function normalizeBank(value: unknown): Bank | null {
  return BANKS.find((bank) => bank === value) ?? null;
}

export function normalizeFamily(value: unknown): FamilyOption | null {
  return FAMILY_OPTIONS.find((option) => option === value) ?? null;
}
