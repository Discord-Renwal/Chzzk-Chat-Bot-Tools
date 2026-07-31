<div align="center">

# Chzzk Bot Platform

**CHZZK（チジク）配信者のためのチャットボット SaaS**

CHZZK アカウントでログインするとチャンネルが作られ、配信チャットに `!입장`（入場）と打つだけでボットが参加します。<br>
CHZZK の**公式 Open API** のみを使用します — 非公式 API もスクレイピングも使いません。

[한국어](../../README.md) ·
[English](README.en.md) ·
[中文](README.zh-CN.md) ·
**日本語**

</div>

---

## 言語 / ライブラリ

| 区分            | 技術                                                                            |
| --------------- | ------------------------------------------------------------------------------- |
| 言語            | TypeScript 5.7（全領域）· CSS · Prisma Schema                                   |
| ランタイム      | Node.js ≥ 20.11 · pnpm 9.15                                                     |
| モノレポ        | Turborepo 2 · pnpm workspace                                                    |
| サーバー        | Fastify 5（`@fastify/cookie` · `cors` · `rate-limit`）                          |
| データベース    | PostgreSQL 16 · Prisma 6                                                        |
| フロントエンド  | React 19 · React Router 8 · Vite 8                                              |
| 状態 / データ   | TanStack Query 5                                                                |
| スタイル        | Tailwind CSS 4 · Radix UI · lucide-react · Motion · Sonner                      |
| フォーム / 検証 | React Hook Form 7 · Zod 3                                                       |
| CHZZK 連携      | `socket.io-client` 2.5（セッションプロトコルが 2.x までしか対応していないため） |
| 決済            | PortOne V2（ビリングキーによる定期課金）                                        |
| テスト / 品質   | Vitest 4 · ESLint 9 · Prettier 3                                                |
| ビルド          | tsup（サーバー）· Vite（フロントエンド）                                        |

**サーバーとフロントが同じ Zod スキーマを共有します。** 検証ルールが一箇所（`packages/contracts`）
にしか存在しないため、フォームと API のルールが食い違うことがありません。

## 構成

4 つの領域を 3 つのプロセスで動かします。

| 領域             | 場所                       | ポート | 役割                                           |
| ---------------- | -------------------------- | ------ | ---------------------------------------------- |
| ① ユーザー       | `apps/web`                 | `5173` | 機能紹介・料金プラン・決済・マイページ         |
| ② チャンネル管理 | `apps/web`（`/dashboard`） | `5173` | 配信者が自分のチャンネルのボットを設定         |
| ③ 内部管理者     | `apps/backoffice`          | `5174` | ユーザー・チャンネル・サブスク・返金・監査ログ |
| ④ Core           | `apps/core`                | `4100` | CHZZK セッション・`!입장` ゲート・コマンド実行 |
| API              | `apps/api`                 | `4000` | 上記フロントが呼ぶ唯一のサーバー               |

```
 ┌──────────────┐        ┌───────────────┐
 │  apps/web    │        │apps/backoffice│      ブラウザ
 │    :5173     │        │     :5174     │
 └──────┬───────┘        └───────┬───────┘
        │  /api（Cookie セッション）
        └────────────┬───────────┘
                     ▼
              ┌─────────────┐        ┌──────────────┐
              │  apps/api   │ ─────▶ │  apps/core   │  共有トークン認証
              │    :4000    │ ◀───── │    :4100     │
              └──────┬──────┘        └──────┬───────┘
                     ▼                      ▼
              ┌──────────────┐       ┌──────────────┐
              │  PostgreSQL  │       │  CHZZK API   │
              └──────────────┘       └──────────────┘
```

## ディレクトリ構成

```
.
├── apps/
│   ├── api/              REST API ゲートウェイ（Fastify）
│   │   ├── src/routes/     auth · billing · botConfig · botControl · chzzkConsole · admin · system
│   │   ├── src/plugins/    authGuard（認証・RBAC）· rawBody（Webhook 署名用に生ボディを保持）
│   │   └── src/            context · coreClient · scheduler · errors · server
│   ├── core/             ボットランタイム worker
│   │   ├── src/adapters/   Postgres を bot-engine のポートに合わせるアダプター
│   │   ├── src/cli/        login · doctor（開発者ツール）
│   │   └── src/            tenantBot · supervisor · controlServer
│   ├── web/              ユーザーサイト + チャンネル管理ダッシュボード
│   │   ├── src/app/        ルーター・プロバイダー・レイアウト
│   │   ├── src/features/   marketing · account · dashboard
│   │   └── src/shared/     API クライアント・型・定数
│   └── backoffice/       内部管理コンソール
│       ├── src/app/        コンソールシェル・サインイン
│       └── src/features/   概要 · ユーザー · チャンネル · 決済 · 監査ログ · お知らせ · フィーチャーフラグ
│
├── packages/
│   ├── contracts/        Zod スキーマと DTO — 双方が共有する契約
│   ├── database/         Prisma スキーマ + テナント分離を強制するリポジトリ
│   ├── bot-engine/       チャット 1 行を解釈する純粋なドメイン（ストレージを知りません）
│   ├── chzzk-sdk/        CHZZK Open API クライアント（こちらのドメインを知りません）
│   ├── auth/             CHZZK OAuth · セッション · トークン暗号化 · RBAC
│   ├── billing/          プラン · サブスクリプションのライフサイクル · PortOne アダプター
│   ├── ui/               2 つのフロントで共有するデザインシステム
│   ├── logger/           ロギング
│   └── platform-config/  環境変数スキーマ · サービス定数
│
├── tooling/              tsconfig · eslint-config · prettier-config
├── infra/                docker-compose（ローカル PostgreSQL）
└── docs/                 アーキテクチャ・ボット機能リファレンス・多言語 README
```

依存の向きは常に一方向です。

```
apps/*  ──▶  auth · billing · database · bot-engine  ──▶  contracts · chzzk-sdk · logger · platform-config
```

- `chzzk-sdk` はテナント・サブスク・ボット設定を一切知りません。
- `bot-engine` はストレージを知りません — すべて `ports.ts` のインターフェース経由で受け取ります。
- Prisma の型が `database` の外に出ることはありません。

設計判断は **[docs/ARCHITECTURE.md](../ARCHITECTURE.md)**、
ボットがチャットで実際に何をするかは **[docs/BOT-FEATURES.md](../BOT-FEATURES.md)** にあります。

## 実行方法

### 事前準備

- Node.js **20.11 以上**
- pnpm **9**（`corepack enable`）
- Docker（ローカル PostgreSQL 用）
- [デベロッパーセンター](https://developers.chzzk.naver.com/application) で CHZZK アプリを登録
  - ログインリダイレクト URL に `http://localhost:4000/api/auth/callback` を登録してください。

### 1. インストールとインフラ起動

```bash
pnpm install
pnpm infra:up          # PostgreSQL コンテナ
```

### 2. 環境変数

```bash
cp .env.example .env
```

`CHZZK_CLIENT_ID` と `CHZZK_CLIENT_SECRET` を入力し、3 つのシークレットを生成します。

```bash
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  （保存する CHZZK トークンの暗号化）
openssl rand -hex 32      # SESSION_SECRET        （セッション Cookie の署名）
openssl rand -hex 32      # INTERNAL_API_TOKEN    （API と Core の共有シークレット）
```

> `TOKEN_ENCRYPTION_KEY` を失うと保存済みトークンを誰も復号できず、全ユーザーが再ログインを迫られます。

内部管理コンソールに入るには、`BOOTSTRAP_SUPER_ADMIN_CHANNEL_ID` に自分の CHZZK チャンネル ID を入れてください。

### 3. データベース

```bash
pnpm db:migrate        # スキーマ適用
pnpm db:seed           # プランカタログ投入 + 最初の管理者を指定
```

### 4. 起動

```bash
pnpm dev               # 4 つのアプリを一度に（turbo）
```

| アドレス                           | 画面                            |
| ---------------------------------- | ------------------------------- |
| <http://localhost:5173>            | ユーザーサイト · チャンネル管理 |
| <http://localhost:5174>            | 内部管理コンソール              |
| <http://localhost:4000/api/health> | API ヘルスチェック              |

個別に起動する場合：

```bash
pnpm dev:api           # API サーバーのみ
pnpm dev:core          # ボット worker のみ
pnpm dev:web           # ユーザーサイトのみ
pnpm dev:backoffice    # 管理コンソールのみ
```

### バックエンドなしで画面だけ見る

DB も CHZZK アカウントもなしで UI を触りたいときに使います。

```bash
VITE_MOCK_API=1 pnpm dev:web
```

`window.fetch` を差し替えて固定データを返します。本番バンドルには含まれません。

### 決済を試す

既定でモックモード（`PORTONE_MOCK=true`）なので、PG アカウントなしでサブスクの全フローを試せます。
金額の下一桁が `9` のときは失敗扱いになるため、失敗経路も再現できます。

### 検証

```bash
pnpm typecheck         # 全ワークスペースの型チェック
pnpm lint
pnpm test
pnpm check             # 上記すべて + フォーマット確認
pnpm build
```

### 開発者ツール

単一アカウントで CHZZK API を確認する場合：

```bash
pnpm --filter @chzzk-bot/core login     # トークン発行 → .tokens/chzzk.json
pnpm --filter @chzzk-bot/core doctor    # クライアント認証・ユーザー認証の点検
```

## 知っておくべきこと

- **呼ばれるまでボットは喋りません。** セッションが繋がっていても、配信者かマネージャーが
  `!입장` と打つまで応答しません。`!퇴장` で退出させます。
- **配信者アカウントでしか使えない機能があります。** 制限管理・チャット設定・フォロワー/サブスク
  一覧は CHZZK 側で配信者権限を要求します。そうでなければ 400 が返り、画面はその事実をそのまま伝えます。
- **メッセージ送信は毎分 30 回までです。** 既定の送信間隔 2000ms はこの上限に合わせてあります。

## セキュリティ

トークンとシークレットは `.env` にのみ置き、コミットしないでください。保存された CHZZK リフレッシュ
トークンは AES-256-GCM で暗号化されます。脆弱性を見つけた場合は公開 Issue ではなく非公開でご連絡ください。

## ライセンス

MIT

---

<div align="center">
<sub>CHZZK（치지직）は NAVER Corp. の商標であり、本プロジェクトは CHZZK と提携関係にありません。</sub>
</div>
