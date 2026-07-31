import { z } from 'zod';

/**
 * 봇 설정의 단일 진실 공급원(single source of truth).
 *
 * 대시보드가 보내는 값과 디스크에 저장된 값을 같은 스키마로 검증하므로,
 * 손으로 고친 설정 파일이 깨져 있어도 부팅 시점에 잡힙니다.
 */

export const userRoleCode = z.enum([
  'streamer',
  'streaming_channel_manager',
  'streaming_chat_manager',
  'common_user',
]);
export type UserRoleCodeValue = z.infer<typeof userRoleCode>;

/** 역할 표시명 — 대시보드와 채팅 안내 문구에서 함께 씁니다. */
export const ROLE_LABELS: Record<UserRoleCodeValue, string> = {
  streamer: '스트리머',
  streaming_channel_manager: '채널 매니저',
  streaming_chat_manager: '채팅 매니저',
  common_user: '일반 시청자',
};

// ─── 커스텀 명령어 ─────────────────────────────────────────────────────────────

/**
 * - `text`   고정 문구를 돌려줍니다. (예: !디스코드 → 초대 링크)
 * - `list`   목록을 기억했다가 보여줍니다. (예: !멤버 빅헤드,9구진 → 저장 / !멤버 → 조회)
 * - `counter` 호출할 때마다 1씩 증가한 숫자를 보여줍니다. (예: !데스)
 */
export const commandType = z.enum(['text', 'list', 'counter']);
export type CommandType = z.infer<typeof commandType>;

export const customCommand = z.object({
  id: z.string(),
  /** 접두사를 뺀 이름. 예: "멤버" */
  name: z.string().min(1).max(30),
  aliases: z.array(z.string().min(1).max(30)).default([]),
  type: commandType.default('text'),

  /**
   * 응답 템플릿. 사용 가능한 치환자:
   *   {user} 호출자 닉네임 · {value} 저장된 값 · {count} 카운터 값 · {n} 항목 개수
   */
  response: z.string().max(300).default(''),

  /** list 타입이 기억하는 항목들 */
  items: z.array(z.string()).default([]),
  /** counter 타입의 현재 값 */
  count: z.number().int().min(0).default(0),

  /** 명령을 사용(조회)할 수 있는 역할 */
  useRoles: z
    .array(userRoleCode)
    .default(['streamer', 'streaming_channel_manager', 'streaming_chat_manager', 'common_user']),
  /** 값을 수정할 수 있는 역할 (list/counter 에서만 의미 있음) */
  editRoles: z.array(userRoleCode).default(['streamer', 'streaming_channel_manager']),

  /**
   * 구독자만 쓸 수 있게 제한합니다.
   * CHAT 이벤트에는 구독 여부가 없어서, 구독자 목록을 주기적으로 받아 대조합니다.
   * 스트리머 계정이 아니면 목록 조회가 막혀 이 옵션이 동작하지 않습니다.
   */
  subscriberOnly: z.boolean().default(false),

  /** 같은 사람이 다시 쓰기까지 기다려야 하는 시간(초) */
  cooldownSec: z.number().int().min(0).max(3600).default(3),
  enabled: z.boolean().default(true),

  /** 통계 */
  usedCount: z.number().int().min(0).default(0),
});
export type CustomCommand = z.infer<typeof customCommand>;

// ─── 채팅 자동응답 ─────────────────────────────────────────────────────────────

/**
 * - `contains` 메시지에 포함되면
 * - `equals`   메시지 전체가 일치하면
 * - `startsWith` 로 시작하면
 * - `regex`    정규식에 걸리면
 */
export const matchMode = z.enum(['contains', 'equals', 'startsWith', 'regex']);
export type MatchMode = z.infer<typeof matchMode>;

export const autoResponse = z.object({
  id: z.string(),
  /** 대시보드에서 구분하기 위한 이름 */
  label: z.string().max(50).default(''),
  pattern: z.string().min(1).max(200),
  mode: matchMode.default('contains'),
  caseSensitive: z.boolean().default(false),
  response: z.string().min(1).max(300),
  /** 채널 전체 공통 쿨다운(초). 같은 문구가 도배되는 걸 막습니다. */
  cooldownSec: z.number().int().min(0).max(3600).default(10),
  /** 0~100. 100 이면 항상 응답합니다. */
  chancePercent: z.number().int().min(1).max(100).default(100),
  enabled: z.boolean().default(true),
});
export type AutoResponse = z.infer<typeof autoResponse>;

// ─── 금칙어 ───────────────────────────────────────────────────────────────────

/**
 * - `blind`             메시지 숨기기만
 * - `blindAndWarn`      숨기고 채팅으로 경고
 * - `blindAndTempBan`   숨기고 임시 제한
 */
export const moderationAction = z.enum(['blind', 'blindAndWarn', 'blindAndTempBan']);
export type ModerationAction = z.infer<typeof moderationAction>;

export const bannedWord = z.object({
  id: z.string(),
  pattern: z.string().min(1).max(200),
  mode: matchMode.default('contains'),
  caseSensitive: z.boolean().default(false),
  action: moderationAction.default('blindAndWarn'),
  /** 경고 문구. 비우면 기본 문구를 씁니다. */
  warnMessage: z.string().max(200).default(''),
  enabled: z.boolean().default(true),
  /** 몇 번 걸렸는지 */
  hitCount: z.number().int().min(0).default(0),
});
export type BannedWord = z.infer<typeof bannedWord>;

/**
 * 스팸 필터.
 *
 * 영어권 봇의 "대문자 비율" 필터는 한글에 의미가 없어서 넣지 않았습니다.
 * 대신 한국 채팅에서 실제로 문제가 되는 자음 연타(ㅋㅋㅋㅋ…), 같은 말 반복,
 * 링크 도배를 기준으로 잡았습니다.
 */
export const spamSettings = z.object({
  enabled: z.boolean().default(false),

  /** 같은 문자가 연속으로 이만큼 넘게 나오면 도배로 봅니다. 0 이면 검사 안 함. */
  maxRepeatedChars: z.number().int().min(0).max(100).default(0),
  /** 메시지 최대 길이. 0 이면 제한 없음. */
  maxLength: z.number().int().min(0).max(1000).default(0),
  /** 같은 사람이 이 시간(초) 안에 똑같은 메시지를 또 보내면 차단. 0 이면 검사 안 함. */
  duplicateWindowSec: z.number().int().min(0).max(600).default(0),
  /** 한 메시지에 허용할 이모티콘 개수. 0 이면 제한 없음. */
  maxEmojis: z.number().int().min(0).max(100).default(0),

  /** 링크 차단 */
  blockLinks: z.boolean().default(false),
  /** 링크를 허용할 도메인 (예: youtube.com) */
  allowedDomains: z.array(z.string()).default([]),

  /** 이 역할들은 스팸 검사에서 제외됩니다. */
  exemptRoles: z
    .array(userRoleCode)
    .default(['streamer', 'streaming_channel_manager', 'streaming_chat_manager']),

  /**
   * 단계적 제재. 위반 횟수에 따라 조치가 세집니다.
   * 위반 기록은 아래 시간(분)이 지나면 사라집니다.
   */
  escalate: z.boolean().default(true),
  violationDecayMinutes: z.number().int().min(1).max(1440).default(30),
  /** 몇 번째 위반부터 임시 제한을 걸지 (allowTempBan 이 켜져 있어야 실제로 실행) */
  tempBanAfterViolations: z.number().int().min(2).max(20).default(3),
});
export type SpamSettings = z.infer<typeof spamSettings>;

export const moderationSettings = z.object({
  enabled: z.boolean().default(true),
  /** 이 역할들은 금칙어 검사를 건너뜁니다. */
  exemptRoles: z
    .array(userRoleCode)
    .default(['streamer', 'streaming_channel_manager', 'streaming_chat_manager']),
  /** 임시 제한 조치를 실제로 실행할지. 꺼두면 숨기기까지만 합니다. */
  allowTempBan: z.boolean().default(false),
  words: z.array(bannedWord).default([]),
  spam: spamSettings.default({}),
});
export type ModerationSettings = z.infer<typeof moderationSettings>;

// ─── 봇 권한 ──────────────────────────────────────────────────────────────────

export const permissionSettings = z.object({
  /** 대시보드 없이 채팅에서 명령어를 관리할 수 있는 역할 */
  manageCommands: z.array(userRoleCode).default(['streamer', 'streaming_channel_manager']),
  /** 역할과 무관하게 관리자로 취급할 채널 ID 목록 */
  extraAdminChannelIds: z.array(z.string()).default([]),
  /** 봇이 아예 무시할 채널 ID (다른 봇 등) */
  ignoredChannelIds: z.array(z.string()).default([]),
});
export type PermissionSettings = z.infer<typeof permissionSettings>;

// ─── 주기 메시지 ──────────────────────────────────────────────────────────────

export const timerMessage = z.object({
  id: z.string(),
  label: z.string().max(50).default(''),
  message: z.string().min(1).max(300),
  /** 발사 간격(분) */
  intervalMinutes: z.number().int().min(1).max(1440).default(15),
  /**
   * 지난 발사 이후 이만큼 채팅이 오가야 다시 보냅니다.
   * 0 이면 조건 없이 시간만 보고 보냅니다 — 빈 방송에 봇 혼자 떠드는 걸 막는 장치입니다.
   */
  minChatsSinceLast: z.number().int().min(0).max(500).default(10),
  enabled: z.boolean().default(true),
});
export type TimerMessage = z.infer<typeof timerMessage>;

// ─── 포인트 ───────────────────────────────────────────────────────────────────

export const attendanceSettings = z.object({
  enabled: z.boolean().default(true),
  /** 출석 기본 보상 */
  reward: z.number().int().min(0).max(100_000).default(100),
  /** 연속 출석 하루당 추가 보상 */
  streakBonus: z.number().int().min(0).max(10_000).default(20),
  /** 연속 보너스 상한 */
  maxStreakBonus: z.number().int().min(0).max(100_000).default(200),
});

export const pointSettings = z.object({
  enabled: z.boolean().default(true),
  /** 포인트의 표시 이름. 채널마다 "젤리", "코인" 등으로 부릅니다. */
  unitName: z.string().min(1).max(10).default('포인트'),
  /** 채팅 1회당 적립량 */
  perChat: z.number().int().min(0).max(10_000).default(10),
  /** 같은 사람의 연속 채팅에 중복 적립되지 않도록 하는 간격(초) */
  chatCooldownSec: z.number().int().min(0).max(3600).default(60),
  /** 후원 1000원당 적립량 */
  perThousandWon: z.number().int().min(0).max(100_000).default(100),
  /** 구독 1개월당 적립량 */
  perSubscriptionMonth: z.number().int().min(0).max(100_000).default(500),
  attendance: attendanceSettings.default({}),
});
export type PointSettings = z.infer<typeof pointSettings>;

// ─── 신청곡 ───────────────────────────────────────────────────────────────────

export const songSettings = z.object({
  enabled: z.boolean().default(false),
  /** 한 사람이 대기열에 동시에 올릴 수 있는 곡 수 */
  maxPerUser: z.number().int().min(1).max(20).default(2),
  /** 대기열 전체 상한 */
  maxQueueSize: z.number().int().min(1).max(200).default(30),
  /** 신청에 드는 포인트. 0 이면 무료 */
  cost: z.number().int().min(0).max(1_000_000).default(0),
  /** 이미 대기 중인 곡과 같은 제목을 허용할지 */
  allowDuplicate: z.boolean().default(false),
  /** 신청할 수 있는 역할 */
  allowedRoles: z
    .array(userRoleCode)
    .default(['streamer', 'streaming_channel_manager', 'streaming_chat_manager', 'common_user']),
});
export type SongSettings = z.infer<typeof songSettings>;

// ─── 미니게임 ─────────────────────────────────────────────────────────────────

/**
 * 포인트를 거는 게임.
 *
 * 포인트가 쌓이기만 하고 쓸 데가 없으면 아무도 신경 쓰지 않습니다.
 * 소모처를 만들어 순환을 주는 게 목적이라, 기대값은 1보다 살짝 낮게 잡았습니다.
 */
export const gameSettings = z.object({
  enabled: z.boolean().default(false),
  /** 최소/최대 베팅. 최대는 한 번에 전 재산을 날리는 걸 막습니다. */
  minBet: z.number().int().min(1).max(1_000_000).default(10),
  maxBet: z.number().int().min(1).max(10_000_000).default(1000),
  /** 같은 사람의 게임 간격(초) */
  cooldownSec: z.number().int().min(0).max(3600).default(30),

  /** !도박 — 이길 확률(%). 이기면 베팅액만큼 벌고, 지면 잃습니다. */
  gambleEnabled: z.boolean().default(true),
  gambleWinPercent: z.number().int().min(1).max(99).default(45),

  /** !주사위 — 봇과 주사위를 굴려 높은 쪽이 이깁니다. 무승부는 베팅액 반환. */
  diceEnabled: z.boolean().default(true),

  /** !슬롯 — 3개가 같으면 대박, 2개가 같으면 소액. */
  slotsEnabled: z.boolean().default(true),
  /** 3개 일치 배율 */
  slotsJackpotMultiplier: z.number().int().min(2).max(100).default(10),
  /** 2개 일치 배율 */
  slotsPairMultiplier: z.number().int().min(1).max(20).default(2),
});
export type GameSettings = z.infer<typeof gameSettings>;

// ─── 인사 / 알림 ──────────────────────────────────────────────────────────────

export const greetingSettings = z.object({
  enabled: z.boolean().default(false),
  /** 이 채널에서 처음 채팅한 사람에게 */
  firstTimeMessage: z.string().max(300).default('{user}님 처음 오셨네요, 환영합니다!'),
});

export const notificationSettings = z.object({
  donationEnabled: z.boolean().default(true),
  /** 치환자: {user} {amount} {message} */
  donationMessage: z.string().max(300).default('{user}님, {amount}원 후원 감사합니다!'),
  /** 이 금액 미만은 알리지 않습니다. 소액 도배 방지. */
  donationMinAmount: z.number().int().min(0).default(0),

  subscriptionEnabled: z.boolean().default(true),
  /** 치환자: {user} {month} {tier} */
  subscriptionMessage: z.string().max(300).default('{user}님, {month}개월 구독 감사합니다!'),

  greeting: greetingSettings.default({}),
});
export type NotificationSettings = z.infer<typeof notificationSettings>;

// ─── 전체 설정 ────────────────────────────────────────────────────────────────

export const generalSettings = z.object({
  /** 봇 전체 on/off. 끄면 어떤 응답도 보내지 않습니다. */
  enabled: z.boolean().default(true),
  prefix: z.string().min(1).max(5).default('!'),
  /**
   * 메시지 사이 최소 간격(ms).
   *
   * 공식 문서에 쿼터 수치가 없지만, 커뮤니티에서 확인된 값은 **분당 30요청**입니다.
   * 기본값 2000ms 는 분당 30회에 해당합니다. 더 낮추면 429 와 봇 계정 스팸 제재
   * 위험이 있으니, 줄이려면 실제 반응을 보면서 조금씩 내리세요.
   */
  sendIntervalMs: z.number().int().min(500).max(10_000).default(2000),
  /** 알 수 없는 명령어에 "그런 명령 없습니다" 라고 답할지 */
  replyOnUnknownCommand: z.boolean().default(false),
});
export type GeneralSettings = z.infer<typeof generalSettings>;

export const botConfig = z.object({
  version: z.literal(1).default(1),
  general: generalSettings.default({}),
  permissions: permissionSettings.default({}),
  moderation: moderationSettings.default({}),
  commands: z.array(customCommand).default([]),
  autoResponses: z.array(autoResponse).default([]),
  timers: z.array(timerMessage).default([]),
  points: pointSettings.default({}),
  songs: songSettings.default({}),
  games: gameSettings.default({}),
  notifications: notificationSettings.default({}),
});
export type BotConfig = z.infer<typeof botConfig>;

/** 빈 설정에서 시작할 때 쓰는 기본값 */
export function defaultConfig(): BotConfig {
  return botConfig.parse({});
}

/**
 * 처음 실행하는 사람이 바로 감을 잡도록 넣어두는 예시 설정.
 * 요청하신 `!멤버` 명령이 여기에 들어 있습니다.
 */
export function starterConfig(): BotConfig {
  return botConfig.parse({
    commands: [
      {
        id: 'cmd_member',
        name: '멤버',
        aliases: ['member', '팀'],
        type: 'list',
        response: '오늘의 멤버 ({n}명): {value}',
        items: [],
        // 스트리머와 매니저만 목록을 바꿀 수 있고, 조회는 누구나 가능합니다.
        editRoles: ['streamer', 'streaming_channel_manager'],
        cooldownSec: 5,
      },
      {
        id: 'cmd_discord',
        name: '디스코드',
        aliases: ['discord'],
        type: 'text',
        response: '디스코드 주소는 여기입니다 → (주소를 입력하세요)',
        cooldownSec: 10,
      },
    ],
    autoResponses: [
      {
        id: 'ar_hello',
        label: '인사 받아주기',
        pattern: '안녕',
        mode: 'contains',
        response: '{user}님 안녕하세요! 반갑습니다 :)',
        cooldownSec: 30,
      },
    ],
  });
}
