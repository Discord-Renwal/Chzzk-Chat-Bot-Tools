/**
 * 치지직 Open API 클라이언트.
 *
 * 이 패키지는 우리 도메인을 전혀 모릅니다 — 테넌트도, 구독도, 봇 설정도 모릅니다.
 * 치지직이 주는 것과 받는 것만 다루므로, 우리 서비스와 무관하게 그대로 재사용할
 * 수 있고 치지직 API 가 바뀌면 여기만 고치면 됩니다.
 */

export { ChzzkClient, type ChzzkClientOptions } from './client.js';

export { HttpClient, CHZZK_API_BASE, type TokenProvider, type AuthMode } from './core/http.js';
export { ChzzkApiError, ChzzkTransportError, ChzzkValidationError } from './core/errors.js';

export { UsersApi } from './api/users.js';
export { ChannelsApi, MAX_CHANNEL_IDS } from './api/channels.js';
export {
  ChatApi,
  splitMessage,
  MAX_MESSAGE_LENGTH,
  ALLOWED_MIN_FOLLOWER_MINUTES,
  ALLOWED_SLOW_MODE_SEC,
  type UpdateChatSettingsInput,
  type BlindMessageInput,
} from './api/chat.js';
export { LivesApi, type UpdateLiveSettingInput } from './api/lives.js';
export { CategoriesApi } from './api/categories.js';
export { RestrictionsApi } from './api/restrictions.js';
export {
  SessionsApi,
  MAX_SUBSCRIPTIONS_PER_SESSION,
  MAX_CLIENT_SESSIONS,
  MAX_USER_SESSIONS,
} from './api/sessions.js';
export { DropsApi, type ListRewardClaimsParams } from './api/drops.js';
export type * from './api/types.js';

export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshToken,
  revokeToken,
  generateState,
  CHZZK_AUTHORIZE_URL,
  CHZZK_TOKEN_URL,
  CHZZK_REVOKE_URL,
  type OAuthConfig,
} from './auth/oauth.js';
export { FileTokenStore, toStoredToken, type StoredToken } from './auth/tokenStore.js';

export { ChzzkSessionClient, type SessionClientOptions } from './session/sessionClient.js';
export type * from './session/events.js';
