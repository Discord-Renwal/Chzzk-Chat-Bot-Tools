<div align="center">

# Chzzk Bot Platform

**面向 CHZZK（치지직）主播的聊天机器人 SaaS**

用 CHZZK 账号登录即可自动创建频道，在直播聊天室输入 `!입장`（进场）机器人就会加入。<br>
仅使用 CHZZK **官方 Open API** —— 不使用非官方接口，也不做网页抓取。

[한국어](../../README.md) ·
[English](README.en.md) ·
**中文** ·
[日本語](README.ja.md)

</div>

---

## 语言 / 依赖库

| 分类        | 技术栈                                                     |
| ----------- | ---------------------------------------------------------- |
| 语言        | TypeScript 5.7（全部）· CSS · Prisma Schema                |
| 运行时      | Node.js ≥ 20.11 · pnpm 9.15                                |
| Monorepo    | Turborepo 2 · pnpm workspace                               |
| 服务端      | Fastify 5（`@fastify/cookie` · `cors` · `rate-limit`）     |
| 数据库      | PostgreSQL 16 · Prisma 6                                   |
| 前端        | React 19 · React Router 8 · Vite 8                         |
| 状态 / 数据 | TanStack Query 5                                           |
| 样式        | Tailwind CSS 4 · Radix UI · lucide-react · Motion · Sonner |
| 表单 / 校验 | React Hook Form 7 · Zod 3                                  |
| CHZZK 对接  | `socket.io-client` 2.5（其会话协议仅支持 2.x）             |
| 支付        | PortOne V2（基于 billing key 的订阅扣款）                  |
| 测试 / 质量 | Vitest 4 · ESLint 9 · Prettier 3                           |
| 构建        | tsup（服务端）· Vite（前端）                               |

**服务端与前端共用同一套 Zod schema。** 校验规则只存在于一个地方（`packages/contracts`），
因此表单与接口的规则不可能出现分歧。

## 整体结构

四个业务域，三个进程。

| 业务域     | 位置                       | 端口   | 职责                               |
| ---------- | -------------------------- | ------ | ---------------------------------- |
| ① 用户     | `apps/web`                 | `5173` | 功能介绍、套餐、支付、我的页面     |
| ② 频道管理 | `apps/web`（`/dashboard`） | `5173` | 主播配置自己频道的机器人           |
| ③ 内部管理 | `apps/backoffice`          | `5174` | 用户、频道、订阅、退款、审计日志   |
| ④ Core     | `apps/core`                | `4100` | CHZZK 会话、`!입장` 门禁、命令执行 |
| API        | `apps/api`                 | `4000` | 上述前端唯一调用的服务端           |

```
 ┌──────────────┐        ┌───────────────┐
 │  apps/web    │        │apps/backoffice│      浏览器
 │    :5173     │        │     :5174     │
 └──────┬───────┘        └───────┬───────┘
        │   /api（Cookie 会话）   │
        └────────────┬───────────┘
                     ▼
              ┌─────────────┐        ┌──────────────┐
              │  apps/api   │ ─────▶ │  apps/core   │  共享令牌认证
              │    :4000    │ ◀───── │    :4100     │
              └──────┬──────┘        └──────┬───────┘
                     ▼                      ▼
              ┌──────────────┐       ┌──────────────┐
              │  PostgreSQL  │       │  CHZZK API   │
              └──────────────┘       └──────────────┘
```

## 目录结构

```
.
├── apps/
│   ├── api/              REST API 网关（Fastify）
│   │   ├── src/routes/     auth · billing · botConfig · botControl · chzzkConsole · admin · system
│   │   ├── src/plugins/    authGuard（认证与 RBAC）· rawBody（保留原始报文以校验 Webhook 签名）
│   │   └── src/            context · coreClient · scheduler · errors · server
│   ├── core/             机器人运行时 worker
│   │   ├── src/adapters/   把 Postgres 适配到 bot-engine 的端口
│   │   ├── src/cli/        login · doctor（开发者工具）
│   │   └── src/            tenantBot · supervisor · controlServer
│   ├── web/              用户站点 + 频道管理后台
│   │   ├── src/app/        路由、Provider、布局
│   │   ├── src/features/   marketing · account · dashboard
│   │   └── src/shared/     API 客户端、类型、常量
│   └── backoffice/       内部管理控制台
│       ├── src/app/        控制台外壳、登录
│       └── src/features/   概览 · 用户 · 频道 · 支付 · 审计日志 · 公告 · 功能开关
│
├── packages/
│   ├── contracts/        Zod schema 与 DTO —— 前后端共享的契约
│   ├── database/         Prisma schema + 强制租户隔离的仓储层
│   ├── bot-engine/       解析每条聊天的纯领域逻辑（不感知存储）
│   ├── chzzk-sdk/        CHZZK Open API 客户端（不感知我们的业务）
│   ├── auth/             CHZZK OAuth · 会话 · 令牌加密 · RBAC
│   ├── billing/          套餐 · 订阅生命周期 · PortOne 适配器
│   ├── ui/               两个前端共用的设计系统
│   ├── logger/           日志
│   └── platform-config/  环境变量 schema · 服务常量
│
├── tooling/              tsconfig · eslint-config · prettier-config
├── infra/                docker-compose（本地 PostgreSQL）
└── docs/                 架构文档、机器人功能说明、多语言 README
```

依赖方向始终单向。

```
apps/*  ──▶  auth · billing · database · bot-engine  ──▶  contracts · chzzk-sdk · logger · platform-config
```

- `chzzk-sdk` 不知道租户、订阅或机器人配置的存在。
- `bot-engine` 不知道存储 —— 一切都通过 `ports.ts` 接口传入。
- Prisma 类型不会离开 `database` 包。

设计决策见 **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**；
机器人在聊天中的具体行为见 **[docs/BOT-FEATURES.md](../BOT-FEATURES.md)**。

## 运行方式

### 前置条件

- Node.js **20.11 以上**
- pnpm **9**（`corepack enable`）
- Docker（用于本地 PostgreSQL）
- 在 [开发者中心](https://developers.chzzk.naver.com/application) 注册 CHZZK 应用
  - 登录重定向 URL 需填写 `http://localhost:4000/api/auth/callback`。

### 1. 安装与启动基础设施

```bash
pnpm install
pnpm infra:up          # PostgreSQL 容器
```

### 2. 环境变量

```bash
cp .env.example .env
```

填写 `CHZZK_CLIENT_ID` 与 `CHZZK_CLIENT_SECRET`，并自行生成三个密钥：

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  （加密存储的 CHZZK 令牌）
openssl rand -hex 32      # SESSION_SECRET        （签名会话 Cookie）
openssl rand -hex 32      # INTERNAL_API_TOKEN    （API 与 Core 之间的共享密钥）
```

> 一旦丢失 `TOKEN_ENCRYPTION_KEY`，已存储的令牌将无法解密，所有用户都必须重新登录。

若要进入内部管理控制台，请把自己的 CHZZK 频道 ID 填入 `BOOTSTRAP_SUPER_ADMIN_CHANNEL_ID`。

### 3. 数据库

```bash
pnpm db:migrate        # 应用 schema
pnpm db:seed           # 写入套餐目录 + 指定首位管理员
```

### 4. 启动

```bash
pnpm dev               # 一次性启动四个应用（turbo）
```

| 地址                               | 页面                |
| ---------------------------------- | ------------------- |
| <http://localhost:5173>            | 用户站点 · 频道管理 |
| <http://localhost:5174>            | 内部管理控制台      |
| <http://localhost:4000/api/health> | API 健康检查        |

单独启动：

```bash
pnpm dev:api           # 仅 API 服务
pnpm dev:core          # 仅机器人 worker
pnpm dev:web           # 仅用户站点
pnpm dev:backoffice    # 仅管理控制台
```

### 不启动后端也能看界面

在没有数据库和 CHZZK 账号时调整界面：

```bash
VITE_MOCK_API=1 pnpm dev:web
```

它会拦截 `window.fetch` 并返回固定数据，且不会被打包进生产构建。

### 试用支付流程

默认为模拟模式（`PORTONE_MOCK=true`），无需 PG 账号即可走完整个订阅流程。
金额个位为 `9` 时会被判定为失败，因此失败路径同样可复现。

### 校验

```bash
pnpm typecheck         # 全 workspace 类型检查
pnpm lint
pnpm test
pnpm check             # 以上全部 + 格式检查
pnpm build
```

### 开发者工具

用单个账号验证 CHZZK API：

```bash
pnpm --filter @chzzk-bot/core login     # 签发令牌 → .tokens/chzzk.json
pnpm --filter @chzzk-bot/core doctor    # 检查客户端与用户认证
```

## 需要知道的几件事

- **未被叫进来之前，机器人不会说话。** 即使会话已连接，也要等主播或管理员输入 `!입장`；
  用 `!퇴장` 让它离开。
- **部分功能仅主播账号可用。** 封禁管理、聊天设置、关注者/订阅者列表都需要 CHZZK 的主播权限，
  否则会返回 400，界面会如实提示。
- **发送速率限制为每分钟 30 条。** 默认 2000ms 的发送间隔正是按这个上限设定的。

## 安全

请将令牌与密钥仅保存在 `.env` 中，不要提交到仓库。存储的 CHZZK refresh token 使用 AES-256-GCM 加密。
发现漏洞请私下告知，不要以公开 issue 的形式提交。

## 许可证

MIT

---

<div align="center">
<sub>CHZZK（치지직）是 NAVER Corp. 的商标，本项目与 CHZZK 无隶属或合作关系。</sub>
</div>
