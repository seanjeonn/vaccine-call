# W1 음성 대화 PoC — 검증 결과

> 상태: **측정 대기** (코드 구현 완료, 실측은 사용자 진행 필요)
> 관련: 이슈 #4, PRD 마일스톤 W1, 브랜치 `feature/poc-voice-loop`

## 1. 목적

브라우저에서 한국어 턴제 음성 대화(STT → LLM → TTS)가 실제로 성립하는지, 그리고 지연·품질이 데모로 쓸 만한지 검증한다. 이 루프가 성립해야 F1(AI 모의 사기 훈련)·F3(통화 코파일럿)이 가능하다.

## 2. 검증한 스택

| 컴포넌트 | 채택 | 구현 위치 |
| --- | --- | --- |
| 프레임워크/호스팅 | Next.js 16 (App Router) + Vercel | 루트 앱 |
| STT | OpenAI `gpt-4o-mini-transcribe` (`language: ko`) | `app/api/stt/route.ts` |
| LLM | OpenAI `gpt-4o` (max_tokens 400) | `app/api/chat/route.ts` |
| TTS | OpenAI `gpt-4o-mini-tts` (voice `onyx`, 사기꾼 톤 instructions) | `app/api/tts/route.ts` |
| 녹음 | MediaRecorder (`audio/webm`) | `app/page.tsx` |

서버 API 라우트가 키 프록시 역할을 하며, 각 컴포넌트는 라우트 1개 교체로 스왑 가능하도록 설계했다.

## 3. 측정 방법

`.env.local`에 키 입력 → `npm run dev` → 브라우저에서 폰 프레임 데모의 마이크 버튼으로 5턴 대화. 각 턴의 STT/LLM/TTS/합계 지연은 화면 우측 하단 패널에 ms 단위로 표시된다. Vercel Preview URL에서도 동일 시나리오 반복.

## 4. 측정 결과 (실측 후 채울 것)

### 4.1 턴 지연 (ms) — 목표 ≤ 4000, 허용 ≤ 7000

| 환경 | 턴 | STT | LLM | TTS | 합계 |
| --- | --- | --- | --- | --- | --- |
| 로컬 | 1 |  |  |  |  |
| 로컬 | 2 |  |  |  |  |
| 로컬 | 3 |  |  |  |  |
| Vercel | 1 |  |  |  |  |
| Vercel | 2 |  |  |  |  |

### 4.2 한국어 STT 정확도 — 목표 10문장 중 ≥ 8 정확

- 정확 인식: __ / 10
- 오인식 사례:
  -

### 4.3 한국어 TTS 품질

- 자연스러움 (1~5):
- 사기꾼 톤 반영 정도:
- 비고:

### 4.4 기기 호환

- 데스크톱 Chrome: (완주 성공률 __/10)
- 기타:

## 5. 판정 (실측 후 작성)

- [ ] 성공 기준 충족 → 기능명세서에 스택 확정, W2 진입
- [ ] STT 미달 → `gpt-4o-transcribe` 승격 / Clova·ReturnZero 대안
- [ ] TTS 미달 → ElevenLabs / Clova Voice 대안
- [ ] 지연 미달 → LLM `gpt-4o-mini`로 교체 + 문장 단위 TTS 파이프라이닝

**결론:**
_(F1을 음성으로 갈지, 다운스코프할지 여기에 확정 기록 — W1의 필수 산출물)_

## 6. 미해결 리스크 / 후속 과제

-
