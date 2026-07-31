import 'dotenv/config';
import { z } from 'zod';

/**
 * 환경 변수 검증.
 *
 * 서비스마다 필요한 값이 다릅니다. Core 는 치지직 자격 증명이 없으면 아무것도
 * 못 하지만 결제 키는 필요 없고, API 는 그 반대입니다. 하나의 거대한 스키마로
 * 묶으면 "이 서비스에 필요 없는 값" 때문에 부팅이 막히거나, 반대로 진짜 필요한
 * 값이 빠진 채로 떠서 첫 요청에서야 죽습니다. 그래서 서비스별로 나눕니다.
 *
 * 잘못된 값은 **부팅 시점에** 어떤 키가 왜 문제인지 알리고 멈춥니다.
 */

const nodeEnv = z.enum(['development', 'test', 'production']).default('development');
const logLevel = z.enum(['silent', 'error', 'warn', 'info', 'debug']).default('info');

/** 모든 서비스가 공유하는 값 */
const commonSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
});

/** 치지직 애플리케이션 자격 증명 — 로그인과 봇 동작 모두에 필요합니다. */
const chzzkSchema = z.object({
  CHZZK_CLIENT_ID: z.string().min(1, 'CHZZK_CLIENT_ID 가 비어 있습니다.'),
  CHZZK_CLIENT_SECRET: z.string().min(1, 'CHZZK_CLIENT_SECRET 이 비어 있습니다.'),
  /** 개발자센터의 "로그인 리디렉션 URL" 과 문자 단위로 같아야 합니다. */
  CHZZK_REDIRECT_URI: z.string().url(),
});

const databaseSchema = z.object({
  DATABASE_URL: z.string().url('DATABASE_URL 은 postgres:// 로 시작하는 URL 이어야 합니다.'),
});

/**
 * 저장된 치지직 리프레시 토큰을 암호화하는 키.
 *
 * 32바이트를 base64 로 인코딩한 값입니다. 이 키가 없으면 남의 방송 계정 토큰을
 * 평문으로 DB 에 두게 되므로 선택 항목이 아닙니다.
 * `openssl rand -base64 32` 로 만드세요.
 */
const encryptionSchema = z.object({
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'base64 로 인코딩한 32바이트여야 합니다.'
    ),
  /** 로그인 세션 쿠키에 서명하는 키 */
  SESSION_SECRET: z.string().min(32, '최소 32자 이상이어야 합니다.'),
});

// ─── API 서버 ─────────────────────────────────────────────────────────────────

const apiSchema = commonSchema
  .merge(chzzkSchema)
  .merge(databaseSchema)
  .merge(encryptionSchema)
  .extend({
    API_PORT: z.coerce.number().int().positive().default(4000),
    API_HOST: z.string().default('0.0.0.0'),
    /** 브라우저에서 접근하는 프런트 주소. CORS 와 OAuth 리디렉션에 씁니다. */
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    BACKOFFICE_ORIGIN: z.string().url().default('http://localhost:5174'),

    /** Core 워커 제어 API 주소 */
    CORE_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4100'),
    /** API ↔ Core 사이의 공유 비밀. 이게 없으면 누구나 남의 봇을 조작할 수 있습니다. */
    INTERNAL_API_TOKEN: z.string().min(16, '최소 16자 이상이어야 합니다.'),

    /** PortOne(아임포트) V2 */
    PORTONE_STORE_ID: z.string().min(1),
    PORTONE_API_SECRET: z.string().min(1),
    PORTONE_CHANNEL_KEY: z.string().min(1),
    /** 웹훅 서명 검증 키. 없으면 위조된 결제 알림을 걸러낼 수 없습니다. */
    PORTONE_WEBHOOK_SECRET: z.string().min(1),
    /** true 면 PG 대신 메모리 목(mock)을 씁니다. 로컬 개발 전용입니다. */
    PORTONE_MOCK: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  });

export type ApiEnv = z.infer<typeof apiSchema>;

// ─── Core 워커 ────────────────────────────────────────────────────────────────

const coreSchema = commonSchema
  .merge(chzzkSchema)
  .merge(databaseSchema)
  .merge(encryptionSchema.pick({ TOKEN_ENCRYPTION_KEY: true }))
  .extend({
    CORE_PORT: z.coerce.number().int().positive().default(4100),
    /** 제어 API 는 내부망 전용입니다. 기본값을 루프백으로 두는 이유입니다. */
    CORE_HOST: z.string().default('127.0.0.1'),
    INTERNAL_API_TOKEN: z.string().min(16),

    /** 이 워커가 맡을 최대 테넌트 수. 넘으면 새 봇을 받지 않고 거절합니다. */
    CORE_MAX_TENANTS: z.coerce.number().int().positive().default(200),
    /** 설정 변경을 DB 에서 다시 읽는 주기(ms) */
    CORE_CONFIG_REFRESH_MS: z.coerce.number().int().min(1000).default(30_000),
    /** 워커 식별자. 여러 대를 띄울 때 로그와 DB 에서 구분합니다. */
    CORE_WORKER_ID: z.string().default('core-1'),
  });

export type CoreEnv = z.infer<typeof coreSchema>;

// ─── 개발자 도구 (login / doctor) ─────────────────────────────────────────────

const cliSchema = commonSchema.merge(chzzkSchema).extend({
  CHZZK_LOGIN_PORT: z.coerce.number().int().positive().default(3000),
  CHZZK_TOKEN_FILE: z.string().default('.tokens/chzzk.json'),
});

export type CliEnv = z.infer<typeof cliSchema>;

// ─── 공통 로더 ────────────────────────────────────────────────────────────────

function load<T extends z.ZodTypeAny>(schema: T, service: string): z.infer<T> {
  const parsed = schema.safeParse(process.env);
  if (parsed.success) return parsed.data as z.infer<T>;

  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(
    `[${service}] 환경 변수 검증에 실패했습니다.\n${detail}\n\n` +
      `.env.example 을 .env 로 복사한 뒤 값을 채워 주세요.`
  );
}

/** 같은 프로세스에서 여러 번 불려도 한 번만 파싱합니다. */
function memoize<T>(fn: () => T): () => T {
  let cached: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      cached = fn();
      done = true;
    }
    return cached as T;
  };
}

export const loadApiEnv = memoize(() => load(apiSchema, 'api'));
export const loadCoreEnv = memoize(() => load(coreSchema, 'core'));
export const loadCliEnv = memoize(() => load(cliSchema, 'cli'));
