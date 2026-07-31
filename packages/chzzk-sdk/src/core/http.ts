import { ChzzkApiError, ChzzkTransportError } from './errors.js';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

export const CHZZK_API_BASE = 'https://openapi.chzzk.naver.com';

/**
 * 문서상 인증 방식은 두 가지이고 서로 배타적입니다.
 * - `client`: Client-Id / Client-Secret 헤더
 * - `user`:   Authorization: Bearer {AccessToken}
 */
export type AuthMode = 'client' | 'user' | 'none';

/** 액세스 토큰을 공급하고, 만료 시 갱신할 수 있는 주체 */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** 401 을 만났을 때 호출됩니다. 갱신된 액세스 토큰을 돌려주세요. */
  refreshAccessToken?(): Promise<string>;
}

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: AuthMode;
  query?: Record<string, string | number | boolean | string[] | undefined> | undefined;
  body?: unknown;
  /** 이 호출에 한해 사용할 액세스 토큰 (TokenProvider 보다 우선) */
  accessToken?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface HttpClientOptions {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokenProvider?: TokenProvider | undefined;
  logger?: Logger | undefined;
  /** 개별 요청 타임아웃(ms). 기본 10초 */
  timeoutMs?: number;
  /** 429 / 5xx 재시도 횟수. 기본 2회 */
  maxRetries?: number;
}

/** CHZZK 공통 응답 봉투: 성공 시 `content`, 실패 시 `code` + `message` */
interface Envelope<T> {
  code: number;
  message: string | null;
  content?: T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isEnvelope(value: unknown): value is Envelope<unknown> {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly log: Logger;

  constructor(private readonly options: HttpClientOptions) {
    this.baseUrl = options.baseUrl ?? CHZZK_API_BASE;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.log = (options.logger ?? noopLogger).child('http');
  }

  async request<T>(opts: RequestOptions): Promise<T> {
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      try {
        return await this.dispatch<T>(opts);
      } catch (error) {
        if (!(error instanceof ChzzkApiError)) throw error;

        // 만료된 액세스 토큰은 한 번만 갱신 후 재시도합니다.
        const canRefresh =
          error.isUnauthorized &&
          !refreshed &&
          opts.auth === 'user' &&
          !opts.accessToken &&
          typeof this.options.tokenProvider?.refreshAccessToken === 'function';

        if (canRefresh) {
          refreshed = true;
          this.log.info('액세스 토큰이 만료되어 갱신을 시도합니다.');
          await this.options.tokenProvider!.refreshAccessToken!();
          continue;
        }

        // 429 는 요청이 거절된 것이므로 어떤 메서드든 안전하게 재시도할 수 있습니다.
        // 5xx 는 다릅니다 — 서버가 이미 처리한 뒤 실패했을 수 있어, POST 를 재시도하면
        // 같은 채팅이 두 번 나갈 수 있습니다. 그래서 5xx 재시도는 GET 으로 한정합니다.
        const retryable = error.isRateLimited || (error.status >= 500 && opts.method === 'GET');
        if (retryable && attempt < this.maxRetries) {
          const backoff = 500 * 2 ** attempt;
          this.log.warn(
            `${error.status} 응답 — ${backoff}ms 후 재시도합니다 (${attempt + 1}/${this.maxRetries})`
          );
          await sleep(backoff);
          continue;
        }

        throw error;
      }
    }
  }

  private async dispatch<T>(opts: RequestOptions): Promise<T> {
    const url = new URL(opts.path, this.baseUrl);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value === undefined) continue;
      // 배열 파라미터(channelIds 등)는 키를 반복해 전달합니다.
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    if (opts.auth === 'client') {
      headers['Client-Id'] = this.options.clientId;
      headers['Client-Secret'] = this.options.clientSecret;
    } else if (opts.auth === 'user') {
      const token = opts.accessToken ?? (await this.requireToken());
      // 문서 주의사항: "Bearer" 와 토큰 사이 공백을 빠뜨리면 안 됩니다.
      headers['Authorization'] = `Bearer ${token}`;
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    this.log.debug(`${opts.method} ${url.pathname}${url.search}`);

    let response: Response;
    try {
      response = await fetch(url, {
        method: opts.method,
        headers,
        signal,
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });
    } catch (cause) {
      throw new ChzzkTransportError(`${opts.method} ${opts.path} 요청이 실패했습니다.`, cause);
    }

    const text = await response.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (isEnvelope(parsed)) {
      if (parsed.code >= 400 || !response.ok) {
        throw new ChzzkApiError({
          code: parsed.code,
          status: response.status,
          method: opts.method,
          path: opts.path,
          message: parsed.message ?? response.statusText,
          body: parsed,
        });
      }
      return parsed.content as T;
    }

    if (!response.ok) {
      throw new ChzzkApiError({
        code: response.status,
        status: response.status,
        method: opts.method,
        path: opts.path,
        message: typeof parsed === 'string' && parsed ? parsed : response.statusText,
        body: parsed,
      });
    }

    return parsed as T;
  }

  private async requireToken(): Promise<string> {
    if (!this.options.tokenProvider) {
      throw new Error(
        '사용자 인증이 필요한 호출입니다. `pnpm login` 으로 액세스 토큰을 먼저 발급받으세요.'
      );
    }
    return this.options.tokenProvider.getAccessToken();
  }
}
