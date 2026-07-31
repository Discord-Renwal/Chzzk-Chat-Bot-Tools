/** 서비스 전역 상수. 숫자를 코드 여기저기에 박아두지 않기 위한 곳입니다. */

/** 로그인 세션 유효기간 (14일) */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** 세션 쿠키 이름 */
export const SESSION_COOKIE = 'cbp_session';

/** OAuth state 쿠키 이름과 수명 (10분) */
export const OAUTH_STATE_COOKIE = 'cbp_oauth_state';
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** 신규 가입자에게 주는 무료 체험 기간 (14일) */
export const TRIAL_DAYS = 14;

/**
 * 결제 실패 후 서비스를 유지해 주는 유예 기간 (3일).
 *
 * 카드 한도 초과처럼 금방 풀리는 문제로 방송 중에 봇이 멈추면 피해가 큽니다.
 * 그 사이 하루 한 번 재시도합니다.
 */
export const PAST_DUE_GRACE_DAYS = 3;

/** 정기결제 재시도 간격 (일). 3번 실패하면 EXPIRED 로 내립니다. */
export const BILLING_RETRY_DAYS = [1, 2, 3] as const;

/** 봇을 채팅방에 들이는 명령. 스트리머·매니저만 쓸 수 있습니다. */
export const JOIN_COMMANDS = ['입장', 'join'] as const;
/** 봇을 내보내는 명령 */
export const LEAVE_COMMANDS = ['퇴장', 'leave'] as const;

/** Core 워커가 살아 있다고 보고하는 주기 (ms) */
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** 이 시간 동안 소식이 없으면 죽은 워커로 봅니다. */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** 요청 본문 상한 (1MB). 설정 JSON 이 이보다 클 일은 없습니다. */
export const MAX_REQUEST_BODY_BYTES = 1_000_000;
