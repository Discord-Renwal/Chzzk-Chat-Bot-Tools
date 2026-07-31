/**
 * CHZZK Open API 응답 타입.
 * 필드 이름과 허용값은 공식 문서(https://chzzk.gitbook.io/chzzk)의 표를 그대로 옮긴 것입니다.
 */

/** 커서 기반 페이지네이션 (lives, restrict-channels 등) */
export interface NextPage {
  next: string | null;
}

/** 커서 값이 `cursor` 로 오는 변형 (drops) */
export interface CursorPage {
  cursor: string | null;
}

export interface Paged<T> {
  data: T[];
  page: NextPage;
}

export type CategoryType = 'GAME' | 'SPORTS' | 'ETC';

// ─── users ────────────────────────────────────────────────────────────────────

/** GET /open/v1/users/me */
export interface Me {
  /** 모든 치지직 유저는 채널을 소유하므로 채널 ID 가 곧 유저 식별자입니다. */
  channelId: string;
  channelName: string;
}

// ─── channels ─────────────────────────────────────────────────────────────────

/** GET /open/v1/channels */
export interface Channel {
  channelId: string;
  channelName: string;
  channelImageUrl: string;
  followerCount: number;
  verifiedMark: boolean;
}

/** GET /open/v1/channels/streaming-roles */
export interface StreamingRole {
  managerChannelId: string;
  managerChannelName: string;
  userRole: string;
  createdDate: string;
}

/** GET /open/v1/channels/followers */
export interface Follower {
  channelId: string;
  channelName: string;
  createdDate: string;
}

/** GET /open/v1/channels/subscribers */
export interface Subscriber {
  channelId: string;
  channelName: string;
  month: number;
  tierNo: number;
  createdDate: string;
}

export type SubscriberSort = 'RECENT' | 'LONGER';

// ─── chat ─────────────────────────────────────────────────────────────────────

export type ChatAvailableCondition = 'NONE' | 'REAL_NAME';
export type ChatAvailableGroup = 'ALL' | 'FOLLOWER' | 'MANAGER' | 'SUBSCRIBER';

/** GET /open/v1/chats/settings */
export interface ChatSettings {
  chatAvailableCondition: ChatAvailableCondition;
  chatAvailableGroup: ChatAvailableGroup;
  minFollowerMinute: number;
  allowSubscriberInFollowerMode: boolean;
  chatSlowModeSec: number;
  chatEmojiMode: boolean;
}

/** POST /open/v1/chats/send */
export interface SendMessageResult {
  messageId: string;
}

// ─── lives / streams / categories ─────────────────────────────────────────────

/** GET /open/v1/lives — 시청자 수 높은 순으로 정렬되어 옵니다. */
export interface LiveSummary {
  liveId: number;
  liveTitle: string;
  liveThumbnailImageUrl: string;
  concurrentUserCount: number;
  openDate: string;
  adult: boolean;
  tags: string[];
  categoryType: CategoryType;
  liveCategory: string;
  liveCategoryValue: string;
  channelId: string;
  channelName: string;
  channelImageUrl: string;
}

export interface Category {
  categoryType: CategoryType;
  categoryId: string;
  categoryValue: string;
  posterImageUrl: string;
}

/** GET /open/v1/lives/setting */
export interface LiveSetting {
  defaultLiveTitle: string;
  category: Category;
  tags: string[];
}

/** GET /open/v1/streams/key */
export interface StreamKey {
  streamKey: string;
}

// ─── restrictions ─────────────────────────────────────────────────────────────

/** GET /open/v1/restrict-channels */
export interface RestrictedChannel {
  restrictedChannelId: string;
  restrictedChannelName: string;
  createdDate: string;
  releaseDate: string;
}

// ─── sessions ─────────────────────────────────────────────────────────────────

export type SessionEventType = 'CHAT' | 'DONATION' | 'SUBSCRIPTION';

/** GET /open/v1/sessions/auth, /open/v1/sessions/auth/client */
export interface SessionAuth {
  /** 소켓 연결용 URL. `?auth=TOKEN` 이 이미 포함되어 있고 일정 시간만 유효합니다. */
  url: string;
}

export interface SessionSubscription {
  eventType: SessionEventType;
  channelId: string;
}

/** GET /open/v1/sessions, /open/v1/sessions/client */
export interface SessionInfo {
  sessionKey: string;
  connectedDate: string;
  disconnectedDate: string | null;
  subscribedEvents: SessionSubscription[];
}

// ─── drops ────────────────────────────────────────────────────────────────────

export type FulfillmentState = 'CLAIMED' | 'FULFILLED';

export interface DropRewardClaim {
  claimId: string;
  campaignId: string;
  rewardId: string;
  categoryId: string;
  categoryName: string;
  channelId: string;
  fulfillmentState: FulfillmentState;
  /** RFC3339 UTC */
  claimedDate: string;
  /** RFC3339 UTC */
  updatedDate: string;
}

export type DropUpdateStatus =
  'INVALID_ID' | 'NOT_FOUND' | 'SUCCESS' | 'UNAUTHORIZED' | 'UPDATE_FAILED';

export interface DropUpdateResult {
  status: DropUpdateStatus;
  ids: string[];
}

// ─── oauth ────────────────────────────────────────────────────────────────────

/** POST /auth/v1/token */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  /** 문서상 항상 "Bearer" */
  tokenType: string;
  /** 초 단위. 문서 예시는 문자열 "86400" 이라 두 형태를 모두 받습니다. */
  expiresIn: number | string;
  scope?: string;
}
