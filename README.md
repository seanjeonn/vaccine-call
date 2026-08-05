# 백신콜

2026 금융 AI Challenge 출품작 — 고령 부모 + 자녀(보호자) 연동형 **금융사기 예방·대응 AI 서비스**.
AI가 사기꾼을 연기해 부모님께 모의 훈련 전화를 걸고, 훈련이 끝나면 위험했던 순간을 분석해
자녀에게 자동으로 공유한다.

- 기획: [`docs/planning/problem-definition.md`](docs/planning/problem-definition.md), [`docs/planning/prd.md`](docs/planning/prd.md)
- 조사: [`docs/research/financial-fraud-research.md`](docs/research/financial-fraud-research.md)
- PoC 검증 결과: [`docs/planning/poc-voice-results.md`](docs/planning/poc-voice-results.md)

## 심사위원 체험 (데모)

랜딩(`/`)에서 가입 없이 두 화면을 바로 볼 수 있다.

| 진입 | 경로 | 보이는 것 |
| --- | --- | --- |
| 부모 화면 | `/api/demo?role=parent` | 초대형 UI의 훈련 홈 → 훈련 시작 / 의심 전화 분석 / 피해 구제 |
| 자녀 화면 | `/api/demo?role=child` | 진행 중 통화·알림함·부모 목록·훈련 기록 대시보드 |

부모 화면에서 훈련을 마치면 자녀 화면에 리포트와 알림이 실제로 쌓인다.
마이크가 없어도 `의심 전화가 왔어요 → 체험 모드로 보기`로 F3 전 과정을 볼 수 있다.
데모 계정: `demo-child@vaccinecall.demo` / `demo1234` (`npm run db:seed`로 생성)

## 구현된 기능

### F1 모의 훈련 (음성)

데스크톱 브라우저에서 폰 프레임 목업 안에 **모의 사기 전화**를 재현한다.

- **연속 통화형 UX** — "통화 시작" 한 번으로 마이크가 열리고, 무음 감지(VAD)로 발화가 끝나면 자동으로 턴이 넘어간다. "통화 종료"까지 핸즈프리.
- **사기꾼이 먼저 말함** — 통화 시작 시 연결음(ringback) 재생 후 오프닝 대사가 나온다. 오프닝은 고정 대사라 LLM 없이 TTS만 태워 시작 지연을 줄였다.
- **실제 사례 기반 시나리오 3종** (근거: 조사 리포트 §3)
  1. 기관사칭형 (검찰 수사관)
  2. 가족사칭형/딥보이스 (아들 사칭)
  3. 대출빙자형 (저축은행 상담원)
- **프로필 기반 맞춤 생성** — 부모님의 주거래 은행·가족 구성을 반영해 발신자·오프닝·설득 전략을 통화마다 새로 만든다. 프로필이 없으면 기존처럼 3종을 무작위 배정한다. 생성은 연결음이 우는 동안 끝나 통화 지연에 더해지지 않는다.
- **문장 단위 파이프라이닝** — LLM 응답을 스트리밍으로 받아 문장이 끝나는 대로 TTS를 태운다. 자막은 그 음성이 재생될 때 함께 나온다.
- **훈련 분석 리포트** — 통화가 끝나면 위험했던 발화를 타임라인에 태깅하고(개인정보 노출·금전 요구 순응·지시 이행·심리적 동요) 취약 유형과 예방 팁을 제시한다.
- **턴별 지연 측정 패널** — 개발 모드에서만 표시.

### 처리 흐름

```
마이크 녹음 → STT → LLM(사기꾼 롤플레이, 스트리밍) → 문장별 TTS → 재생 → (VAD) 다시 녹음 …
통화 종료 → 리포트 분석 → (부모 로그인 상태면) 저장 + 자녀 알림
```

### F2 보호자 연동

- 자녀가 가입 후 **초대 링크**를 보내면, 부모는 이름·연령대만 입력하고 시작한다. 가입도 설치도 없다.
- 링크는 1회용이며 7일 뒤 만료된다.
- 부모가 훈련을 마치면 자녀 대시보드에 **리포트와 알림**이 자동으로 도착한다. 위험도가 높으면 알림이 위험 표시로 갈린다.
- 자녀는 부모의 호칭·연령대와 맞춤 훈련용 프로필(주거래 은행·가족 구성)을 수정할 수 있다.

계정은 자녀만 만든다. 부모는 초대 링크로 발급된 세션으로 접속한다.

### F3 실시간 통화 코파일럿

걸려온 의심 전화를 **스피커폰으로 두고 옆에서 듣는다**(`/p/copilot`). 통화에 끼어들지 않는다.

- **5초 단위 청취** — 마이크를 조각내 STT에 보내고, 사기 각본의 **접근 → 압박 → 격리 → 송금 유도** 중 어디까지 왔는지 좇는다. 소리가 없던 조각은 보내지 않는다.
- **위험 게이지와 개입 카드** — 지금 할 말과 할 행동을 큰 글씨 한 장으로 보여준다. 단계가 올라가면 진동으로 알린다.
- **음성 안내는 기본 꺼짐** — 스피커폰 옆에서 안내가 흘러나오면 상대방이 듣는다. 켜면 단계가 올라갈 때만 읽고, 읽는 동안은 녹음을 멈춘다.
- **위험 임계치를 넘으면 자녀에게 자동 알림** — 통화당 1회. 자녀 대시보드에는 진행 중인 통화의 단계와 요약이 5초마다 갱신된다.
- **통화 종료 후 분석 리포트** — 훈련 리포트와 같은 포맷. 위험했던 통화면 피해구제(F4)로 바로 잇는다.
- **체험 모드** — 실제 사기 전화를 기다릴 수 없으니, 마이크 없이 가짜 통화를 두 목소리로 들려주며 같은 파이프라인을 그대로 태운다. 알림도 리포트도 진짜로 쌓인다.

## 기술 스택

| 구분 | 사용 |
| --- | --- |
| 프레임워크 | Next.js 16 (App Router, TypeScript) |
| DB | Neon Postgres (ap-southeast-1) + Prisma 6 |
| 인증 | 자체 구현 — `crypto.scrypt` 해싱 + DB 세션 + httpOnly 쿠키 |
| 스타일 | Tailwind CSS v4 |
| STT | OpenAI `gpt-4o-mini-transcribe` (ko) |
| LLM | OpenAI `gpt-4o` |
| TTS | OpenAI `gpt-4o-mini-tts` (시나리오별 voice/톤) |
| 배포 | Vercel (예정) |

OpenAI 키 하나로 STT/LLM/TTS를 모두 처리한다. 서버 API 라우트가 키 프록시 역할을 하여 클라이언트에 키가 노출되지 않는다.

## 실행

```bash
npm install
cp .env.example .env         # OPENAI_API_KEY, DATABASE_URL 입력
npx prisma migrate deploy    # 스키마 적용
npm run db:seed              # 데모 계정·리포트 생성 (선택)
npm run dev                  # http://localhost:3000
```

> Prisma CLI는 `.env.local`을 읽지 않는다. `DATABASE_URL`은 `.env`에 둔다.
> Vercel 연동으로 받은 값은 `.env.local`에 들어오므로 DB 관련 값만 `.env`로 옮긴다.

> 마이크는 보안 컨텍스트에서만 동작한다. localhost는 예외로 허용되며, 배포 시에는 HTTPS가 필요하다.

## 주요 구조

```
app/
  page.tsx                     # 랜딩 (역할별 리다이렉트 + 데모 진입)
  call/page.tsx                # 통화 UI + 녹음/VAD/재생 상태 머신 + 리포트
  p/page.tsx                   # 부모 홈 (초대형 UI)
  p/copilot/page.tsx           # 의심 전화 실시간 분석 (F3)
  dashboard/page.tsx           # 자녀 대시보드 (진행 중 통화·알림·부모·훈련 기록)
  dashboard/reports/[id]       # 훈련 리포트 상세
  invite/[token]/page.tsx      # 부모 초대 수락
  signup, login                # 자녀 계정
  api/
    stt, chat, tts             # 음성 루프 (chat은 스트리밍)
    scenario                   # 프로필 기반 맞춤 시나리오 생성
    report                     # 리포트 분석 + (부모 세션이면) 저장·알림
    copilot                    # 실시간 통화 분석 틱 (단계·위험도·자녀 알림)
    copilot/call, copilot/live # 통화 세션 시작·종료 / 자녀 폴링 조회
    auth/*, invite/*           # 인증·초대
    parents/[id], notifications/read, demo
lib/
  scenarios.ts                 # 사기 시나리오 3종 (오프닝/프롬프트/voice)
  report.ts                    # 리포트 타입·위험 태그 정의
  copilot.ts                   # 사기 각본 4단계·개입 카드·체험 모드 대본
  notifications.ts             # 자녀 알림 생성
  auth.ts, db.ts, parent.ts    # 세션·Prisma·프로필 상수
prisma/
  schema.prisma, migrations/   # 데이터 모델
  seed.mjs                     # 데모 계정·리포트
docs/                          # 기획·조사·PoC 결과 문서
```

## 상태

- [x] 음성 대화 루프(STT→LLM→TTS) — 스트리밍 + 문장 단위 파이프라이닝 적용
- [x] Vercel 배포 (https://vaccine-call.vercel.app)
- [x] F1-2 음성 모의 훈련 · F1-3 훈련 분석 리포트
- [x] F2 보호자 연동 — 초대·리포트 공유·알림함
- [x] F1-5 훈련 이력 추이 — 회차 비교·반복 취약 유형
- [x] F1-4 훈련 중 개입 — 위험 발화 시 통화 중단·정지 화면
- [x] F1-1 프로필 기반 맞춤 시나리오 — 프로필 반영 생성·실패 시 정적 폴백
- [x] F4 피해구제 AI 사무장 — 골든타임 체크리스트·서류 초안·진행 상황 공유
- [x] F3 실시간 통화 코파일럿 — 의심 전화 청취·위험 게이지·개입 카드·자녀 알림

작업 규칙은 [`docs/github-workflow.md`](docs/github-workflow.md), 프로젝트 지침은 [`CLAUDE.md`](CLAUDE.md) 참고.
