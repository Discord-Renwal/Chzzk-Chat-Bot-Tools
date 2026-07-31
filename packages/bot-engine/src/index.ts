/**
 * 봇 도메인 엔진.
 *
 * 저장소를 모릅니다 — 필요한 것은 전부 `ports.ts` 의 인터페이스로 받습니다.
 * 덕분에 같은 엔진이 로컬에서는 JSON 파일로, 서비스에서는 Postgres 로 돕니다.
 */

// 포트 (바깥에서 구현해 넣어야 하는 것들)
export type { ConfigSource, ViewerStore, SongStore, EventSink, AttendanceResult } from './ports.js';

// 런타임
export { BotRuntime, type RuntimeDeps } from './bot/runtime.js';
export { ChatSender, type ChatSenderOptions } from './bot/chatSender.js';
export {
  CommandRouter,
  type CommandDefinition,
  type CommandContext,
  type CommandRouterOptions,
} from './bot/commandRouter.js';

// 기능 단위 (테스트와 재조합을 위해 개별로도 내보냅니다)
export {
  CustomCommandEngine,
  parseItems,
  render,
  visibleCommandNames,
  MAX_LIST_ITEMS_SHOWN,
  type CommandOutcome,
} from './features/customCommands.js';
export { AutoResponder } from './features/autoResponder.js';
export { Moderator, type ModerationVerdict } from './features/moderation.js';
export { SpamFilter } from './features/spamFilter.js';
export { CooldownTracker } from './features/cooldown.js';
export { matches, isValidPattern } from './features/matcher.js';
export {
  isAdmin,
  isIgnored,
  hasRole,
  normalizeRole,
  canControlBot,
} from './features/permissions.js';
export { PointEngine, formatPoints } from './features/points.js';
export {
  GameEngine,
  GAME_COMMAND_NAMES,
  isGameCommandName,
  type GameResult,
} from './features/games.js';
export { TimerScheduler } from './features/timers.js';
export { ChatterIndex } from './features/chatterIndex.js';
export { AudienceIndex } from './features/audienceIndex.js';
export { ChannelContext, expandVariables, pickRandomVariant } from './features/variables.js';
export { findBuiltin, BUILTIN_COMMANDS } from './features/builtinCommands.js';

// JSON 파일 기반 구현 (로컬 실행 · 테스트)
export { JsonConfigStore } from './state/configStore.js';
export { JsonViewerStore, kstDate, type UserRecord } from './state/userStore.js';
export { JsonSongStore } from './state/songQueue.js';
export { EventLog } from './state/eventLog.js';
export { JsonFile, type JsonFileOptions } from './state/jsonFile.js';
