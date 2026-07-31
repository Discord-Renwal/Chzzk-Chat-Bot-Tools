<div align="center">

# Chzzk Bot Platform

**A chatbot SaaS for CHZZK streamers**

Sign in with your CHZZK account and a channel is created for you. Type `!입장` in chat and the bot joins.<br>
Built on the **official CHZZK Open API** only — no unofficial endpoints, no web scraping.

[한국어](../../README.md) ·
**English** ·
[中文](README.zh-CN.md) ·
[日本語](README.ja.md)

</div>

---

## Languages / Libraries

| Area               | Stack                                                           |
| ------------------ | --------------------------------------------------------------- |
| Language           | TypeScript 5.7 (everywhere) · CSS · Prisma Schema               |
| Runtime            | Node.js ≥ 20.11 · pnpm 9.15                                     |
| Monorepo           | Turborepo 2 · pnpm workspace                                    |
| Server             | Fastify 5 (`@fastify/cookie` · `cors` · `rate-limit`)           |
| Database           | PostgreSQL 16 · Prisma 6                                        |
| Frontend           | React 19 · React Router 8 · Vite 8                              |
| State / Data       | TanStack Query 5                                                |
| Styling            | Tailwind CSS 4 · Radix UI · lucide-react · Motion · Sonner      |
| Forms / Validation | React Hook Form 7 · Zod 3                                       |
| CHZZK integration  | `socket.io-client` 2.5 (their session protocol only speaks 2.x) |
| Payments           | PortOne V2 (billing-key subscriptions)                          |
| Testing / Quality  | Vitest 4 · ESLint 9 · Prettier 3                                |
| Build              | tsup (servers) · Vite (frontends)                               |

**Server and client share the same Zod schemas.** Validation rules live in exactly one place
(`packages/contracts`), so a form and its API endpoint cannot disagree.

## Layout

Four areas across three processes.

| Area             | Location                  | Port   | Responsibility                                     |
| ---------------- | ------------------------- | ------ | -------------------------------------------------- |
| ① Customer       | `apps/web`                | `5173` | Features, pricing, checkout, account               |
| ② Channel admin  | `apps/web` (`/dashboard`) | `5173` | Streamers configure their own bot                  |
| ③ Internal admin | `apps/backoffice`         | `5174` | Users, channels, subscriptions, refunds, audit log |
| ④ Core           | `apps/core`               | `4100` | CHZZK sessions, `!입장` gate, command execution    |
| API              | `apps/api`                | `4000` | The only server those frontends talk to            |

```
 ┌──────────────┐        ┌───────────────┐
 │  apps/web    │        │apps/backoffice│      browser
 │    :5173     │        │     :5174     │
 └──────┬───────┘        └───────┬───────┘
        │  /api (cookie session) │
        └────────────┬───────────┘
                     ▼
              ┌─────────────┐        ┌──────────────┐
              │  apps/api   │ ─────▶ │  apps/core   │  shared-token auth
              │    :4000    │ ◀───── │    :4100     │
              └──────┬──────┘        └──────┬───────┘
                     ▼                      ▼
              ┌──────────────┐       ┌──────────────┐
              │  PostgreSQL  │       │  CHZZK API   │
              └──────────────┘       └──────────────┘
```

## Directory structure

```
.
├── apps/
│   ├── api/              REST API gateway (Fastify)
│   │   ├── src/routes/     auth · billing · botConfig · botControl · chzzkConsole · admin · system
│   │   ├── src/plugins/    authGuard (auth + RBAC) · rawBody (keeps raw body for webhook signatures)
│   │   └── src/            context · coreClient · scheduler · errors · server
│   ├── core/             Bot runtime worker
│   │   ├── src/adapters/   Adapts Postgres to the bot-engine ports
│   │   ├── src/cli/        login · doctor (developer tools)
│   │   └── src/            tenantBot · supervisor · controlServer
│   ├── web/              Customer site + channel admin dashboard
│   │   ├── src/app/        Router, providers, layouts
│   │   ├── src/features/   marketing · account · dashboard
│   │   └── src/shared/     API client, types, constants
│   └── backoffice/       Internal admin console
│       ├── src/app/        Console shell, sign-in
│       └── src/features/   overview · users · tenants · payments · audit · announcements · flags
│
├── packages/
│   ├── contracts/        Zod schemas and DTOs — the contract both sides share
│   ├── database/         Prisma schema + repositories that enforce tenant isolation
│   ├── bot-engine/       Pure chat domain (knows nothing about storage)
│   ├── chzzk-sdk/        CHZZK Open API client (knows nothing about our domain)
│   ├── auth/             CHZZK OAuth · sessions · token encryption · RBAC
│   ├── billing/          Plans · subscription lifecycle · PortOne adapter
│   ├── ui/               Design system shared by both frontends
│   ├── logger/           Logging
│   └── platform-config/  Environment schema · service constants
│
├── tooling/              tsconfig · eslint-config · prettier-config
├── infra/                docker-compose (local PostgreSQL)
└── docs/                 Architecture, bot reference, translated READMEs
```

Dependencies only ever point one way.

```
apps/*  ──▶  auth · billing · database · bot-engine  ──▶  contracts · chzzk-sdk · logger · platform-config
```

- `chzzk-sdk` knows nothing about tenants, subscriptions, or bot config.
- `bot-engine` knows nothing about storage — everything arrives through `ports.ts` interfaces.
- Prisma types never leave `database`.

Design decisions are in **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**; what the bot actually does in
chat is in **[docs/BOT-FEATURES.md](../BOT-FEATURES.md)**.

## Getting started

### Prerequisites

- Node.js **20.11 or newer**
- pnpm **9** (`corepack enable`)
- Docker (for local PostgreSQL)
- A CHZZK application from the [developer center](https://developers.chzzk.naver.com/application)
  - Register `http://localhost:4000/api/auth/callback` as the login redirect URL.

### 1. Install and start infrastructure

```bash
pnpm install
pnpm infra:up          # PostgreSQL container
```

### 2. Environment

```bash
cp .env.example .env
```

Fill in `CHZZK_CLIENT_ID` and `CHZZK_CLIENT_SECRET`, then generate three secrets:

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  (encrypts stored CHZZK tokens)
openssl rand -hex 32      # SESSION_SECRET        (signs session cookies)
openssl rand -hex 32      # INTERNAL_API_TOKEN    (shared secret between API and Core)
```

> Lose `TOKEN_ENCRYPTION_KEY` and no one can decrypt the stored tokens — every user has to sign in again.

To reach the internal admin console, put your own CHZZK channel ID in
`BOOTSTRAP_SUPER_ADMIN_CHANNEL_ID`.

### 3. Database

```bash
pnpm db:migrate        # apply schema
pnpm db:seed           # load the plan catalog + bootstrap the first admin
```

### 4. Run

```bash
pnpm dev               # all four apps at once (turbo)
```

| URL                                | Screen                        |
| ---------------------------------- | ----------------------------- |
| <http://localhost:5173>            | Customer site · channel admin |
| <http://localhost:5174>            | Internal admin console        |
| <http://localhost:4000/api/health> | API health                    |

Individually:

```bash
pnpm dev:api           # API server only
pnpm dev:core          # bot worker only
pnpm dev:web           # customer site only
pnpm dev:backoffice    # admin console only
```

### UI without a backend

For working on the interface without a database or a CHZZK account:

```bash
VITE_MOCK_API=1 pnpm dev:web
```

It intercepts `window.fetch` and returns fixtures. It is never included in a production bundle.

### Trying payments

Mock mode is on by default (`PORTONE_MOCK=true`), so the whole subscription flow works without a PG
account. Amounts ending in `9` fail on purpose, so the failure path is reproducible too.

### Verification

```bash
pnpm typecheck         # every workspace
pnpm lint
pnpm test
pnpm check             # all of the above + format check
pnpm build
```

### Developer tools

To poke the CHZZK API with a single account:

```bash
pnpm --filter @chzzk-bot/core login     # issue a token → .tokens/chzzk.json
pnpm --filter @chzzk-bot/core doctor    # check client and user authentication
```

## Things worth knowing

- **The bot stays silent until invited.** Even with the session connected, it waits for a streamer or
  manager to type `!입장`. `!퇴장` sends it away.
- **Some features require a streamer account.** Restrictions, chat settings, and follower/subscriber
  lists need streamer permission from CHZZK. Otherwise it returns 400, and the UI says so plainly.
- **Sending is capped at 30 messages per minute.** The 2000 ms default interval matches that limit.

## Security

Keep tokens and secrets in `.env` and out of commits. Stored CHZZK refresh tokens are encrypted with
AES-256-GCM. Please report vulnerabilities privately rather than as public issues.

## License

MIT

---

<div align="center">
<sub>CHZZK is a trademark of NAVER Corp. This project is not affiliated with CHZZK.</sub>
</div>
