/**
 * 서버와 **같은 zod 스키마**를 그대로 씁니다.
 *
 * 폼 검증 규칙(문자 수 제한, 허용값, 범위)이 서버와 어긋날 수 없다는 게 핵심입니다.
 * 스키마를 고치면 프런트 타입과 폼 검증이 동시에 따라옵니다.
 *
 * 재수출만 하고 여기서 새로 정의하지 않습니다. 한 줄이라도 여기서 만들면
 * 그 순간부터 서버와 갈라지기 시작합니다.
 */
export {
  botConfig,
  customCommand,
  autoResponse,
  bannedWord,
  timerMessage,
  generalSettings,
  permissionSettings,
  moderationSettings,
  spamSettings,
  pointSettings,
  songSettings,
  gameSettings,
  notificationSettings,
  ROLE_LABELS,
  PLATFORM_ROLE_LABELS,
  TENANT_ROLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  BOT_STATUS_LABELS,
} from '@chzzk-bot/contracts';

export type {
  BotConfig,
  CustomCommand,
  AutoResponse,
  BannedWord,
  TimerMessage,
  CommandType,
  MatchMode,
  ModerationAction,
  SpamSettings,
  PointSettings,
  SongSettings,
  GameSettings,
  NotificationSettings,
  UserRoleCodeValue,
  // 계정 · 테넌시
  SessionUser,
  UserProfile,
  TenantSummary,
  TenantRole,
  PlatformRole,
  // 결제
  Plan,
  PlanCode,
  PlanLimits,
  Subscription,
  SubscriptionStatus,
  Payment,
  BillingCard,
  // 봇 런타임
  BotStats,
  BotInstanceState,
  BotInstanceStatus,
  BotStatusResponse,
  ViewerRecord,
  SongRequest,
  SongsResponse,
  LogEntry,
  LogKind,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  // 치지직 콘솔
  RestrictedChannel,
  ChatSettings,
  Follower,
  Subscriber,
  AudienceResponse,
  StreamingRole,
} from '@chzzk-bot/contracts';

/**
 * 예전 대시보드가 쓰던 이름들.
 *
 * 화면 코드가 `UserRecord`·`StatusResponse` 로 부르고 있어 별칭만 남깁니다.
 * 이름을 한꺼번에 바꾸면 diff 가 커져 정작 바뀐 로직이 묻힙니다.
 */
export type {
  ViewerRecord as UserRecord,
  BotStatusResponse as StatusResponse,
} from '@chzzk-bot/contracts';
