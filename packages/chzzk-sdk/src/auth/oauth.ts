import { randomUUID } from 'node:crypto';
import { ChzzkApiError, ChzzkTransportError } from '../core/errors.js';
import type { TokenResponse } from '../api/types.js';

export const CHZZK_AUTHORIZE_URL = 'https://chzzk.naver.com/account-interlock';
export const CHZZK_TOKEN_URL = 'https://openapi.chzzk.naver.com/auth/v1/token';
export const CHZZK_REVOKE_URL = 'https://openapi.chzzk.naver.com/auth/v1/token/revoke';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  /** 개발자센터에 등록한 "로그인 리디렉션 URL" 과 정확히 일치해야 합니다. */
  redirectUri: string;
}

/** CSRF 방지용 state 값 */
export function generateState(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * 사용자를 보낼 인가 URL을 만듭니다.
 *
 * 참고: 공식 문서는 스코프를 `채팅 메시지 쓰기` 같은 한글 표시명으로만 기술하고 있어,
 * `scope=` 쿼리에 넣을 문자열 형식이 정의되어 있지 않습니다. 실제 권한은 개발자센터에서
 * 애플리케이션에 체크한 스코프로 결정되므로 기본적으로 scope 를 보내지 않습니다.
 */
export function buildAuthorizeUrl(
  config: OAuthConfig,
  options: { state?: string } = {}
): { url: string; state: string } {
  const state = options.state ?? generateState();
  const url = new URL(CHZZK_AUTHORIZE_URL);
  url.searchParams.set('clientId', config.clientId);
  url.searchParams.set('redirectUri', config.redirectUri);
  url.searchParams.set('state', state);
  return { url: url.toString(), state };
}

async function postToken(url: string, body: Record<string, string>): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new ChzzkTransportError(`토큰 엔드포인트(${url}) 호출에 실패했습니다.`, cause);
  }

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    /* 본문이 JSON 이 아니면 원문 그대로 둡니다 */
  }

  const envelope = parsed as { code?: number; message?: string | null; content?: unknown };
  const code = envelope?.code ?? response.status;

  if (!response.ok || code >= 400) {
    throw new ChzzkApiError({
      code,
      status: response.status,
      method: 'POST',
      path: new URL(url).pathname,
      message: envelope?.message ?? response.statusText,
      body: parsed,
    });
  }

  return envelope?.content ?? parsed;
}

/** 인가 코드를 액세스/리프레시 토큰으로 교환합니다. */
export async function exchangeCodeForToken(
  config: OAuthConfig,
  params: { code: string; state: string }
): Promise<TokenResponse> {
  return (await postToken(CHZZK_TOKEN_URL, {
    grantType: 'authorization_code',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code: params.code,
    state: params.state,
  })) as TokenResponse;
}

/**
 * 리프레시 토큰으로 새 토큰을 발급받습니다.
 * 리프레시 토큰은 1회용이라, 응답에 담겨 오는 새 리프레시 토큰을 반드시 저장해야 합니다.
 */
export async function refreshToken(
  config: OAuthConfig,
  refreshTokenValue: string
): Promise<TokenResponse> {
  return (await postToken(CHZZK_TOKEN_URL, {
    grantType: 'refresh_token',
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: refreshTokenValue,
  })) as TokenResponse;
}

/** 토큰을 폐기합니다. */
export async function revokeToken(
  config: OAuthConfig,
  token: string,
  tokenTypeHint: 'access_token' | 'refresh_token' = 'access_token'
): Promise<void> {
  await postToken(CHZZK_REVOKE_URL, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    token,
    tokenTypeHint,
  });
}
