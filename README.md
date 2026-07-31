<div align="center">

# Chzzk Bot Platform

**치지직 스트리머를 위한 챗봇 SaaS**

치지직 계정으로 로그인하면 채널이 만들어지고, 방송 채팅에 `!입장` 만 치면 봇이 들어옵니다.<br>
치지직 **공식 Open API** 만 사용합니다 — 비공식 API 나 웹 스크래핑을 쓰지 않습니다.

**한국어** ·
[English](docs/readme/README.en.md) ·
[中文](docs/readme/README.zh-CN.md) ·
[日本語](docs/readme/README.ja.md)

</div>

---

## 언어 / 라이브러리

| 구분          | 사용 기술                                                  |
| ------------- | ---------------------------------------------------------- |
| 언어          | TypeScript 5.7 (전 영역) · CSS · Prisma Schema             |
| 런타임        | Node.js ≥ 20.11 · pnpm 9.15                                |
| 모노레포      | Turborepo 2 · pnpm workspace                               |
| 서버          | Fastify 5 (`@fastify/cookie` · `cors` · `rate-limit`)      |
| 데이터베이스  | PostgreSQL 16 · Prisma 6                                   |
| 프런트엔드    | React 19 · React Router 8 · Vite 8                         |
| 상태 · 데이터 | TanStack Query 5                                           |
| 스타일        | Tailwind CSS 4 · Radix UI · lucide-react · Motion · Sonner |
| 폼 · 검증     | React Hook Form 7 · Zod 3                                  |
| 치지직 연동   | `socket.io-client` 2.5 (세션 프로토콜이 2.x 까지만 지원)   |
| 결제          | PortOne V2 (빌링키 정기결제)                               |
| 테스트 · 품질 | Vitest 4 · ESLint 9 · Prettier 3                           |
| 빌드          | tsup (서버) · Vite (프런트)                                |

**Zod 를 서버와 프런트가 함께 씁니다.** 검증 규칙이 한 곳(`packages/contracts`)에만 있어, 폼과 API 의
규칙이 어긋날 수 없습니다.

## 구성

네 개의 영역, 세 개의 프로세스로 나뉩니다.

| 영역          | 위치                      | 포트   | 하는 일                                  |
| ------------- | ------------------------- | ------ | ---------------------------------------- |
| ① 사용자      | `apps/web`                | `5173` | 기능 소개 · 요금제 · 결제 · 마이페이지   |
| ② 관리자      | `apps/web` (`/dashboard`) | `5173` | 스트리머가 자기 채널의 봇을 설정         |
| ③ 내부 관리자 | `apps/backoffice`         | `5174` | 사용자 · 채널 · 구독 · 환불 · 감사 로그  |
| ④ Core        | `apps/core`               | `4100` | 치지직 세션 · `!입장` 게이트 · 명령 실행 |
| API           | `apps/api`                | `4000` | 위 화면들이 부르는 유일한 서버           |

```
 ┌──────────────┐        ┌───────────────┐
 │  apps/web    │        │apps/backoffice│      브라우저
 │    :5173     │        │     :5174     │
 └──────┬───────┘        └───────┬───────┘
        │   /api (쿠키 세션)      │
        └────────────┬───────────┘
                     ▼
              ┌─────────────┐        ┌──────────────┐
              │  apps/api   │ ─────▶ │  apps/core   │  내부 토큰 인증
              │    :4000    │ ◀───── │    :4100     │
              └──────┬──────┘        └──────┬───────┘
                     ▼                      ▼
              ┌──────────────┐       ┌──────────────┐
              │  PostgreSQL  │       │  치지직 API  │
              └──────────────┘       └──────────────┘
```

## 디렉토리 구조

```
.
├── apps/
│   ├── api/              REST API 게이트웨이 (Fastify)
│   │   ├── src/routes/     auth · billing · botConfig · botControl · chzzkConsole · admin · system
│   │   ├── src/plugins/    authGuard(인증·RBAC) · rawBody(웹훅 서명용 원본 보관)
│   │   └── src/            context · coreClient · scheduler · errors · server
│   ├── core/             봇 런타임 워커
│   │   ├── src/adapters/   Postgres 를 bot-engine 포트에 맞추는 어댑터
│   │   ├── src/cli/        login · doctor (개발자 도구)
│   │   └── src/            tenantBot · supervisor · controlServer
│   ├── web/              사용자 웹 + 채널 관리자 대시보드
│   │   ├── src/app/        라우터 · 프로바이더 · 레이아웃
│   │   ├── src/features/   marketing · account · dashboard
│   │   └── src/shared/     api 클라이언트 · 타입 · 상수
│   └── backoffice/       내부 관리자 콘솔
│       ├── src/app/        콘솔 셸 · 로그인
│       └── src/features/   개요 · 사용자 · 채널 · 결제 · 감사 로그 · 공지 · 기능 플래그
│
├── packages/
│   ├── contracts/        zod 스키마 · DTO — 서버와 프런트가 함께 쓰는 계약
│   ├── database/         Prisma 스키마 + 테넌트 격리를 강제하는 리포지토리
│   ├── bot-engine/       채팅 한 줄을 해석하는 순수 도메인 (저장소를 모릅니다)
│   ├── chzzk-sdk/        치지직 Open API 클라이언트 (우리 도메인을 모릅니다)
│   ├── auth/             치지직 OAuth · 세션 · 토큰 암호화 · RBAC
│   ├── billing/          요금제 · 구독 수명주기 · PortOne 어댑터
│   ├── ui/               두 프런트가 공유하는 디자인 시스템
│   ├── logger/           로깅
│   └── platform-config/  환경 변수 스키마 · 서비스 상수
│
├── tooling/              tsconfig · eslint-config · prettier-config
├── infra/                docker-compose (로컬 PostgreSQL)
└── docs/                 아키텍처 · 봇 기능 레퍼런스 · 다국어 README
```

의존 방향은 한쪽으로만 흐릅니다.

```
apps/*  ──▶  auth · billing · database · bot-engine  ──▶  contracts · chzzk-sdk · logger · platform-config
```

- `chzzk-sdk` 는 우리 도메인(테넌트 · 구독 · 봇 설정)을 모릅니다.
- `bot-engine` 은 저장소를 모릅니다 — 전부 `ports.ts` 인터페이스로 받습니다.
- `database` 밖으로 Prisma 타입이 나가지 않습니다.

자세한 설계 결정은 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**,
봇이 채팅에서 무엇을 하는지는 **[docs/BOT-FEATURES.md](docs/BOT-FEATURES.md)** 에 있습니다.

## 실행 방법

### 사전 준비

- Node.js **20.11 이상**
- pnpm **9** (`corepack enable` 로 설치)
- Docker (로컬 PostgreSQL 용)
- 치지직 애플리케이션 — [개발자센터](https://developers.chzzk.naver.com/application)에서 발급
  - 로그인 리디렉션 URL 에 `http://localhost:4000/api/auth/callback` 을 등록하세요.

### 1. 설치와 인프라

```bash
pnpm install
pnpm infra:up          # PostgreSQL 컨테이너
```

### 2. 환경 변수

```bash
cp .env.example .env
```

`CHZZK_CLIENT_ID` · `CHZZK_CLIENT_SECRET` 을 채우고, 비밀 값 세 개를 직접 만듭니다.

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  (치지직 토큰 암호화)
openssl rand -hex 32      # SESSION_SECRET        (세션 쿠키 서명)
openssl rand -hex 32      # INTERNAL_API_TOKEN    (API ↔ Core 공유 비밀)
```

> `TOKEN_ENCRYPTION_KEY` 를 잃으면 저장된 토큰을 아무도 복호화할 수 없어 모든 사용자가 재로그인해야 합니다.

내부 관리자 콘솔에 들어가려면 `BOOTSTRAP_SUPER_ADMIN_CHANNEL_ID` 에 자기 치지직 채널 ID 를 넣으세요.

### 3. 데이터베이스

```bash
pnpm db:migrate        # 스키마 적용
pnpm db:seed           # 요금제 카탈로그 반영 + 최초 관리자 지정
```

### 4. 실행

```bash
pnpm dev               # 네 앱을 한꺼번에 (turbo)
```

| 주소                               | 화면                    |
| ---------------------------------- | ----------------------- |
| <http://localhost:5173>            | 사용자 웹 · 채널 관리자 |
| <http://localhost:5174>            | 내부 관리자 콘솔        |
| <http://localhost:4000/api/health> | API 상태                |

개별 실행:

```bash
pnpm dev:api           # API 서버만
pnpm dev:core          # 봇 워커만
pnpm dev:web           # 사용자 웹만
pnpm dev:backoffice    # 관리자 콘솔만
```

### 백엔드 없이 화면만 보기

DB 나 치지직 계정 없이 UI 만 확인할 때 씁니다.

```bash
VITE_MOCK_API=1 pnpm dev:web
```

`window.fetch` 를 가로채 고정 데이터를 돌려줍니다. 프로덕션 번들에는 포함되지 않습니다.

### 결제 확인

기본값이 모의 모드(`PORTONE_MOCK=true`)라 PG 계정 없이 구독 흐름 전체를 눌러 볼 수 있습니다.
금액 끝자리가 `9` 이면 실패로 처리되므로 실패 경로도 재현됩니다.

### 검증

```bash
pnpm typecheck         # 전 워크스페이스 타입 검사
pnpm lint
pnpm test
pnpm check             # 위 전부 + 포맷 확인
pnpm build
```

### 개발자 도구

단일 계정으로 치지직 API 를 확인할 때:

```bash
pnpm --filter @chzzk-bot/core login     # 토큰 발급 → .tokens/chzzk.json
pnpm --filter @chzzk-bot/core doctor    # 클라이언트 · 유저 인증 점검
```

## 알아 둘 것

- **봇은 부르기 전에는 말하지 않습니다.** 세션이 연결돼 있어도 스트리머나 매니저가 `!입장` 을 쳐야
  응답을 시작합니다. `!퇴장` 으로 내보냅니다.
- **스트리머 계정에서만 되는 기능이 있습니다.** 제재 관리 · 채팅 설정 · 팔로워/구독자 목록은 치지직이
  스트리머 권한을 요구합니다. 아니면 400 이 오고, 화면이 그 사실을 그대로 안내합니다.
- **메시지 전송은 분당 30회로 제한됩니다.** 기본 전송 간격 2000ms 가 그 값에 맞춰져 있습니다.

## 보안

토큰과 비밀 값은 `.env` 에만 두고 커밋하지 마세요. 저장된 치지직 리프레시 토큰은 AES-256-GCM 으로
암호화됩니다. 취약점을 발견하면 공개 이슈 대신 비공개로 알려 주세요.

## 라이선스

MIT

---

<div align="center">
<sub>치지직은 NAVER Corp. 의 상표이며, 이 프로젝트는 치지직과 제휴 관계가 없습니다.</sub>
</div>
