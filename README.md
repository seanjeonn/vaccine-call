# 보이스백신 (가칭)

2026 금융 AI Challenge 출품작 — 고령 부모 + 자녀(보호자) 연동형 **금융사기 예방·대응 AI 서비스**.
현재 저장소는 **W1 음성 대화 PoC** 단계로, 핵심 가정(브라우저에서 한국어 턴제 음성 대화가 성립하는가)을 검증한다.

- 기획: [`docs/planning/problem-definition.md`](docs/planning/problem-definition.md), [`docs/planning/prd.md`](docs/planning/prd.md)
- 조사: [`docs/research/financial-fraud-research.md`](docs/research/financial-fraud-research.md)
- PoC 검증 결과: [`docs/planning/poc-voice-results.md`](docs/planning/poc-voice-results.md)

## 현재 구현 (음성 대화 PoC)

데스크톱 브라우저에서 폰 프레임 목업 안에 **모의 사기 전화**를 재현한다.

- **연속 통화형 UX** — "통화 시작" 한 번으로 마이크가 열리고, 무음 감지(VAD)로 발화가 끝나면 자동으로 턴이 넘어간다. "통화 종료"까지 핸즈프리.
- **사기꾼이 먼저 말함** — 통화 시작 시 연결음(ringback) 재생 후 오프닝 대사가 나온다. 오프닝은 고정 대사라 LLM 없이 TTS만 태워 시작 지연을 줄였다.
- **실제 사례 기반 시나리오 3종 랜덤 배정** — 통화마다 무작위 (근거: 조사 리포트 §3)
  1. 기관사칭형 (검찰 수사관)
  2. 가족사칭형/딥보이스 (아들 사칭)
  3. 대출빙자형 (저축은행 상담원)
- **턴별 지연 측정 패널** — STT / LLM / TTS / 합계 (ms)

### 처리 흐름

```
마이크 녹음 → STT → LLM(사기꾼 롤플레이) → TTS → 재생 → (VAD) 다시 녹음 …
```

## 기술 스택

| 구분 | 사용 |
| --- | --- |
| 프레임워크 | Next.js 16 (App Router, TypeScript) |
| 스타일 | Tailwind CSS v4 |
| STT | OpenAI `gpt-4o-mini-transcribe` (ko) |
| LLM | OpenAI `gpt-4o` |
| TTS | OpenAI `gpt-4o-mini-tts` (시나리오별 voice/톤) |
| 배포 | Vercel (예정) |

OpenAI 키 하나로 STT/LLM/TTS를 모두 처리한다. 서버 API 라우트가 키 프록시 역할을 하여 클라이언트에 키가 노출되지 않는다.

## 실행

```bash
npm install
cp .env.example .env.local   # OPENAI_API_KEY 입력
npm run dev                  # http://localhost:3000
```

> 마이크는 보안 컨텍스트에서만 동작한다. localhost는 예외로 허용되며, 배포 시에는 HTTPS가 필요하다.

## 주요 구조

```
app/
  page.tsx            # 통화형 UI + 녹음/VAD/재생 상태 머신 + 지연 패널
  api/stt/route.ts    # 음성 → 텍스트
  api/chat/route.ts   # 대화 이력 + 시나리오 → 사기꾼 응답
  api/tts/route.ts    # 텍스트 → 음성 (시나리오별 목소리)
lib/
  scenarios.ts        # 사기 시나리오 3종 정의 (오프닝/프롬프트/voice)
docs/                 # 기획·조사·PoC 결과 문서
```

## 상태

- [x] 음성 대화 루프(STT→LLM→TTS) 로컬 검증 — 완주 확인, 품질 양호
- [x] 연속 통화형 UX + 시나리오 3종 랜덤 배정
- [ ] Vercel 배포 및 상시 URL 확보
- [ ] 지연 최적화 (TTS 병목 — 스트리밍/문장 단위 파이프라이닝)
- [ ] 본 기능(F1 모의 훈련 리포트, F2 보호자 연동) 구현

작업 규칙은 [`docs/github-workflow.md`](docs/github-workflow.md), 프로젝트 지침은 [`CLAUDE.md`](CLAUDE.md) 참고.
