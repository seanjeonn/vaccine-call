// 사기범의 텍스트 스트림을 합성 단위로 끊는 규칙.
//
// 재생 큐(lib/tts-playback.ts)와 지연 측정 스크립트(scripts/tts-spike.ts)가 같은 규칙을
// 써야 측정이 프로덕션을 대변한다. 스크립트는 Node로 도는데 Node는 "@/" 별칭을 해석하지
// 못하므로, 이 파일은 import를 하나도 두지 않는다. (lib/realtime-session.ts가 배역
// 프롬프트를 공유하는 방식과 같은 제약이다)

// 첫 조각을 끊을 수 있는 자리. 쉼표를 포함한다.
const CLAUSE_BREAK = /[,.!?…\n]/;
// 두 번째 조각부터는 문장 끝에서만 끊는다. 절 단위로 계속 쪼개면 억양이 잘게 끊긴다.
const SENTENCE_BREAK = /[.!?…\n]/;
// 너무 짧은 첫 조각은 오히려 어색하다. ("네." 하나만 먼저 나오고 뚝 끊기는 식)
const MIN_FIRST_CHARS = 6;
// 한 요청이 지나치게 길어지지 않게 하는 상한. 넘으면 절에서라도 끊는다.
const MAX_CHUNK_CHARS = 120;

/**
 * 보낼 수 있는 조각의 끝 위치. 아직 끊을 자리가 없으면 -1.
 *
 * 첫 조각만 쉼표에서도 끊는다. 첫 문장이 완성되기를 기다리면 LLM 쪽에서만 766ms가 드는데
 * 첫 델타는 617ms에 온다. 그 차이가 곧 통화 첫 소리의 지연이다.
 * (실측 근거: docs/planning/tts-provider-spike.md)
 */
export function chunkEnd(text: string, isFirst: boolean): number {
  const at = text.search(isFirst ? CLAUSE_BREAK : SENTENCE_BREAK);
  if (at >= 0 && (!isFirst || at + 1 >= MIN_FIRST_CHARS)) return at + 1;
  // 종결부호 없이 길어지는 경우. 소리가 멈추지 않게 어디서든 끊는다.
  if (text.length >= MAX_CHUNK_CHARS) {
    const clause = text.search(CLAUSE_BREAK);
    return clause >= MIN_FIRST_CHARS ? clause + 1 : MAX_CHUNK_CHARS;
  }
  return -1;
}
