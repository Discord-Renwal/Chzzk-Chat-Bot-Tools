import type { SessionEventType } from '../api/types.js';

/** 채팅 작성자의 역할 */
export type UserRoleCode =
  'streamer' | 'common_user' | 'streaming_channel_manager' | 'streaming_chat_manager';

export interface ChatProfile {
  nickname: string;
  badges: Record<string, unknown>[];
  verifiedMark: boolean;
}

/** socket.io `CHAT` 이벤트 페이로드 */
export interface ChatEvent {
  /** 이벤트가 발생한 채널 */
  channelId: string;
  /** 메시지 작성자의 채널 ID */
  senderChannelId: string;
  /** 임시제한 / 메시지 숨기기에 사용하는 채팅 채널 ID */
  chatChannelId: string;
  profile: ChatProfile;
  userRoleCode: UserRoleCode;
  content: string;
  /** key = 이모티콘 식별자, value = 이미지 URL */
  emojis: Record<string, string>;
  /** 메시지 시각 (ms) */
  messageTime: number;
}

/** socket.io `DONATION` 이벤트 페이로드 */
export interface DonationEvent {
  donationType: 'CHAT' | 'VIDEO';
  channelId: string;
  donatorChannelId: string;
  donatorNickname: string;
  /** 후원 금액(원). 문서상 숫자가 아니라 문자열입니다. */
  payAmount: string;
  donationText: string;
  emojis: Record<string, string>;
}

/** socket.io `SUBSCRIPTION` 이벤트 페이로드 */
export interface SubscriptionEvent {
  channelId: string;
  subscriberChannelId: string;
  subscriberNickname: string;
  /** 1 = 티어1, 2 = 티어2 */
  tierNo: number;
  tierName: string;
  /** 사용된 구독 기간(개월) */
  month: number;
}

/** socket.io `SYSTEM` 이벤트 페이로드 */
export type SystemEvent =
  | { type: 'connected'; data: { sessionKey: string } }
  | {
      type: 'subscribed' | 'unsubscribed' | 'revoked';
      data: { eventType: SessionEventType; channelId: string };
    };

/** ChzzkSessionClient 가 발행하는 이벤트 목록 */
export interface SessionClientEvents {
  /** 소켓이 열리고 sessionKey 를 받아 구독까지 마쳤을 때 */
  ready: [{ sessionKey: string }];
  chat: [ChatEvent];
  donation: [DonationEvent];
  subscription: [SubscriptionEvent];
  system: [SystemEvent];
  /** 사용자가 동의를 철회했거나 스코프가 바뀌어 권한이 회수됨 */
  revoked: [{ eventType: SessionEventType; channelId: string }];
  disconnect: [{ reason: string }];
  reconnecting: [{ attempt: number; delayMs: number }];
  error: [Error];
}
