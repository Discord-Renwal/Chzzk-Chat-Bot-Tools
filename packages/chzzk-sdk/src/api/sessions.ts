import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { SessionAuth, SessionEventType, SessionInfo } from './types.js';

/** 세션 하나가 구독할 수 있는 이벤트 총합 (채팅+후원+구독 합산) */
export const MAX_SUBSCRIPTIONS_PER_SESSION = 30;
/** 클라이언트 인증 세션의 동시 연결 상한 */
export const MAX_CLIENT_SESSIONS = 10;
/** 유저 인증 세션의 동시 연결 상한 */
export const MAX_USER_SESSIONS = 3;

const PATHS: Record<SessionEventType, string> = {
  CHAT: 'chat',
  DONATION: 'donation',
  SUBSCRIPTION: 'subscription',
};

/**
 * 세션(소켓) API.
 *
 * 채팅 **수신**용 REST 엔드포인트는 존재하지 않습니다. 흐름은 항상 다음과 같습니다:
 *   1. `createUserSession()` / `createClientSession()` 로 소켓 URL 발급
 *   2. socket.io 로 접속 → SYSTEM `connected` 이벤트에서 `sessionKey` 수령
 *   3. 그 `sessionKey` 로 `subscribe()` 호출
 *
 * 구독은 REST 로만 가능하며 소켓으로 emit 하는 이벤트는 없습니다.
 */
export class SessionsApi {
  constructor(private readonly http: HttpClient) {}

  /** 유저 인증 세션 생성. 토큰 소유자의 이벤트만 구독할 수 있습니다. */
  async createUserSession(): Promise<SessionAuth> {
    return this.http.request<SessionAuth>({
      method: 'GET',
      path: '/open/v1/sessions/auth',
      auth: 'user',
    });
  }

  /** 클라이언트 인증 세션 생성 */
  async createClientSession(): Promise<SessionAuth> {
    return this.http.request<SessionAuth>({
      method: 'GET',
      path: '/open/v1/sessions/auth/client',
      auth: 'client',
    });
  }

  /** 유저 세션 목록. 끊긴 세션은 90일간 조회됩니다. */
  async listUserSessions(params: { page?: number; size?: number } = {}): Promise<SessionInfo[]> {
    assertSize(params.size);
    const res = await this.http.request<{ data: SessionInfo[] }>({
      method: 'GET',
      path: '/open/v1/sessions',
      auth: 'user',
      query: { page: params.page, size: params.size },
    });
    return res.data;
  }

  /** 클라이언트 세션 목록 */
  async listClientSessions(params: { page?: number; size?: number } = {}): Promise<SessionInfo[]> {
    assertSize(params.size);
    const res = await this.http.request<{ data: SessionInfo[] }>({
      method: 'GET',
      path: '/open/v1/sessions/client',
      auth: 'client',
      query: { page: params.page, size: params.size },
    });
    return res.data;
  }

  /**
   * 이벤트 구독. 대상 채널은 인증 주체로 결정되므로 `sessionKey` 외의 파라미터가 없습니다.
   *
   * @param authMode 세션을 만들 때 쓴 인증 방식과 동일해야 합니다.
   */
  async subscribe(
    eventType: SessionEventType,
    sessionKey: string,
    authMode: 'user' | 'client' = 'user'
  ): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: `/open/v1/sessions/events/subscribe/${PATHS[eventType]}`,
      auth: authMode,
      query: { sessionKey },
    });
  }

  /** 구독 취소 */
  async unsubscribe(
    eventType: SessionEventType,
    sessionKey: string,
    authMode: 'user' | 'client' = 'user'
  ): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: `/open/v1/sessions/events/unsubscribe/${PATHS[eventType]}`,
      auth: authMode,
      query: { sessionKey },
    });
  }
}

function assertSize(size: number | undefined): void {
  if (size === undefined) return;
  if (size < 1 || size > 50) {
    throw new ChzzkValidationError(`size 는 1 이상 50 이하여야 합니다 (받은 값: ${size}).`);
  }
}
