/**
 * 치지직 서버 상태를 그대로 비추는 화면(제재·채팅설정·시청자)이 쓰는 모양.
 *
 * 우리 DB 가 아니라 치지직이 주인인 값이라, 저장하지 않고 그때그때 지나보냅니다.
 * 스트리머 계정이 아니면 치지직이 400 을 주므로 화면은 항상 실패를 감안해야 합니다.
 */

export interface RestrictedChannel {
  restrictedChannelId: string;
  restrictedChannelName: string;
  createdDate: string;
  releaseDate: string;
}

export interface ChatSettings {
  chatAvailableCondition: 'NONE' | 'REAL_NAME';
  chatAvailableGroup: 'ALL' | 'FOLLOWER' | 'MANAGER' | 'SUBSCRIBER';
  minFollowerMinute: number;
  allowSubscriberInFollowerMode: boolean;
  chatSlowModeSec: number;
  chatEmojiMode: boolean;
}

export interface Follower {
  channelId: string;
  channelName: string;
  createdDate: string;
}

export interface Subscriber {
  channelId: string;
  channelName: string;
  month: number;
  tierNo: number;
  createdDate: string;
}

export interface AudienceResponse {
  followers: Follower[];
  subscribers: Subscriber[];
  /** 팔로워 조회만 실패할 수 있어 오류를 따로 담습니다. */
  followersError: string | null;
  subscribersError: string | null;
}

export interface StreamingRole {
  managerChannelId: string;
  managerChannelName: string;
  userRole: string;
  createdDate: string;
}
