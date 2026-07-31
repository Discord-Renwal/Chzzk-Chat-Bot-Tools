import type {
  ChatEvent,
  ChzzkClient,
  DonationEvent,
  SubscriptionEvent,
} from '@chzzk-bot/chzzk-sdk';
import type { ConfigSource, EventSink, SongStore, ViewerStore } from '../ports.js';
import type {
  BotConfig,
  BotStats,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
} from '@chzzk-bot/contracts';
import { JOIN_COMMANDS, LEAVE_COMMANDS } from '@chzzk-bot/platform-config';
import { ChatSender } from './chatSender.js';
import { AutoResponder } from '../features/autoResponder.js';
import { CustomCommandEngine } from '../features/customCommands.js';
import { Moderator } from '../features/moderation.js';
import { SpamFilter } from '../features/spamFilter.js';
import { PointEngine, formatPoints } from '../features/points.js';
import { GameEngine, GAME_COMMAND_NAMES, type GameResult } from '../features/games.js';
import { ChatterIndex } from '../features/chatterIndex.js';
import { AudienceIndex } from '../features/audienceIndex.js';
import { TimerScheduler } from '../features/timers.js';
import { ChannelContext, expandVariables, pickRandomVariant } from '../features/variables.js';
import { findBuiltin, BUILTIN_COMMANDS } from '../features/builtinCommands.js';
import { canControlBot, isAdmin, isIgnored } from '../features/permissions.js';
import type { Logger } from '@chzzk-bot/logger';
import { ChzzkApiError } from '@chzzk-bot/chzzk-sdk';

export interface RuntimeDeps {
  chzzk: ChzzkClient;
  config: ConfigSource;
  users: ViewerStore;
  songs: SongStore;
  log: EventSink;
  botChannelId: string;
  /**
   * 입장/퇴장이 일어나면 알려줍니다. Core 워커가 이 신호로 DB 의 봇 상태를
   * 갱신해, 대시보드에 "입장 완료" 가 뜨게 합니다.
   */
  onJoinChange?: ((joined: boolean, by: string | null) => void) | undefined;
  /**
   * true 로 시작하면 `!입장` 없이 바로 동작합니다.
   * 로컬에서 자기 채널에만 붙여 쓰는 단일 채널 모드용입니다.
   */
  autoJoin?: boolean | undefined;
}

/**
 * 채팅 이벤트 하나를 처리하는 파이프라인.
 *
 * 순서가 곧 정책입니다:
 *   0. 입장 게이트 — `!입장` 전에는 관리 명령 외 아무것도 하지 않습니다.
 *   1. 무시 대상 / 봇 자신 걸러내기
 *   2. 스팸 · 금칙어 — **명령어보다 먼저**. 그렇지 않으면 금칙어를 명령 인자에
 *      실어 보내는 우회가 가능합니다.
 *   3. 포인트 적립 (제재당한 메시지에는 주지 않습니다)
 *   4. 명령어 (게임 → 내장 → 사용자 정의)
 *   5. 자동응답
 */
export class BotRuntime {
  private readonly commands: CustomCommandEngine;
  private readonly autoResponder = new AutoResponder();
  private readonly moderator = new Moderator();
  private readonly spamFilter = new SpamFilter();
  private readonly points: PointEngine;
  private readonly games: GameEngine;
  private readonly chatters = new ChatterIndex();
  private readonly audience: AudienceIndex;
  /**
   * 마지막으로 관측한 채팅 채널 ID.
   * 임시 제한 해제 API 가 이 값을 요구하는데, 대시보드에는 이 정보가 없어서
   * 지나가는 채팅 이벤트에서 주워 둡니다.
   */
  private lastChatChannel: string | undefined;
  /**
   * 봇이 이 방에 "입장" 했는지.
   *
   * 세션이 연결돼 채팅을 듣고 있어도, 스트리머나 매니저가 `!입장` 을 치기 전에는
   * 아무 말도 하지 않습니다. 구독만 하면 바로 떠드는 봇은 방송 준비 중이거나
   * 다른 봇을 쓰는 날에 방해가 됩니다. 들어오고 나가는 걸 방송 주인이 정합니다.
   */
  private joined = false;
  private joinedByNickname: string | null = null;
  private readonly channel: ChannelContext;
  private readonly sender: ChatSender;
  private readonly timers: TimerScheduler;
  private readonly log: Logger;

  /** 사람별 명령 실행 횟수 ($유저카운트) */
  private readonly userCommandCounts = new Map<string, number>();

  readonly stats: BotStats = {
    startedAt: Date.now(),
    messagesSeen: 0,
    commandsRun: 0,
    autoResponsesSent: 0,
    moderationActions: 0,
    spamBlocked: 0,
    pointsAwarded: 0,
    lastChatAt: null,
    uniqueChatters: 0,
  };

  constructor(private readonly deps: RuntimeDeps) {
    const { chzzk, config, users } = deps;

    this.commands = new CustomCommandEngine(config);
    this.points = new PointEngine(users);
    this.games = new GameEngine(users);
    this.channel = new ChannelContext(chzzk, 60_000, chzzk.logger);
    this.audience = new AudienceIndex(chzzk, deps.botChannelId, 10 * 60_000, chzzk.logger);
    this.log = chzzk.logger.child('runtime');

    this.sender = new ChatSender(chzzk.chat, {
      // 값이 아니라 함수를 넘겨, 대시보드에서 바꾼 간격이 재시작 없이 반영되게 합니다.
      intervalMs: () => this.deps.config.snapshot().general.sendIntervalMs,
      logger: chzzk.logger,
    });

    this.timers = new TimerScheduler(
      () => this.deps.config.snapshot().timers,
      (message) => this.sendOrThrow(this.expandForTimer(message)),
      { logger: chzzk.logger }
    );

    this.joined = deps.autoJoin ?? false;
  }

  start(): void {
    // 주기 메시지는 입장한 뒤에만 돕니다. 대기 중인 방에 봇 혼자 떠들면 안 됩니다.
    if (this.joined) this.timers.start();
    void this.channel.refresh();
    void this.audience.refresh();
  }

  /** 지금 방에 들어와 있는지 */
  get isJoined(): boolean {
    return this.joined;
  }

  /** `!입장` 을 친 사람. 입장 전이면 null */
  get joinedBy(): string | null {
    return this.joinedByNickname;
  }

  /**
   * 채팅을 거치지 않고 입장/퇴장시킵니다. 대시보드의 버튼이 이 경로를 씁니다.
   *
   * 채팅으로 들어오든 버튼으로 들어오든 결과가 같아야 하므로, 두 경로 모두
   * 이 메서드 하나로 모읍니다.
   */
  setJoined(joined: boolean, by: string | null = null): void {
    if (this.joined === joined) return;

    this.joined = joined;
    this.joinedByNickname = joined ? by : null;

    if (joined) this.timers.start();
    else this.timers.stop();

    this.deps.onJoinChange?.(joined, this.joinedByNickname);
  }

  /** 임시 제한 해제에 필요합니다. 채팅이 한 번도 안 왔으면 undefined */
  get lastChatChannelId(): string | undefined {
    return this.lastChatChannel;
  }

  /** 구독자 전용 명령이 동작할 수 있는 상태인지 */
  get subscriberDataAvailable(): boolean {
    return this.audience.isSubscriberDataAvailable;
  }

  stop(): void {
    this.timers.stop();
  }

  /** 대시보드에서 타이머가 바뀌면 알려줍니다. */
  syncTimers(): void {
    this.timers.sync();
  }

  // ─── 채팅 ──────────────────────────────────────────────────────────────────

  async handleChat(event: ChatEvent): Promise<void> {
    const config = this.deps.config.snapshot();

    // 봇 자신과 무시 대상은 통계에도 넣지 않습니다. 넣으면 "본 메시지" 가
    // 실제로 처리한 양과 어긋납니다.
    if (event.senderChannelId === this.deps.botChannelId) return;
    if (isIgnored(event, config.permissions)) return;

    // 임시제한 해제에 필요한 값이라, 봇이 꺼져 있어도 기록해 둡니다.
    this.lastChatChannel = event.chatChannelId;

    this.stats.messagesSeen += 1;
    this.stats.lastChatAt = Date.now();
    this.stats.uniqueChatters = this.deps.users.userCount;

    if (!config.general.enabled) return;

    // 입장 게이트.
    //
    // `!입장` / `!퇴장` 은 다른 무엇보다 먼저 봅니다. 금칙어 검사보다도 앞인데,
    // 스트리머가 봇을 부르는 말이 금칙어에 걸려 영영 못 부르는 상황을 막기
    // 위해서입니다. 입장 전에는 이 두 명령 외에 어떤 응답도 내보내지 않습니다.
    if (await this.handleJoinGate(event, config)) return;
    if (!this.joined) return;

    this.chatters.remember(event);
    this.timers.noteChat();
    void this.audience.refresh();

    const nickname = event.profile?.nickname ?? '';
    const firstEver = this.deps.users.isFirstEver(event.senderChannelId);

    // 1) 금칙어 — 스팸보다 **먼저** 봅니다.
    //
    // 순서를 바꾸면 우회가 생깁니다. 예전에는 스팸을 먼저 봐서,
    // 금칙어 뒤에 "ㅋㅋㅋㅋㅋㅋ" 만 붙이면 스팸(1회차 경고)으로 처리되고
    // 금칙어에 설정한 임시제한이 실행되지 않았습니다. 적발 횟수도 오르지 않아
    // 대시보드에는 "이 단어는 쓰인 적 없음" 으로 보였습니다.
    const verdict = this.moderator.inspect(event, config);
    if (verdict) {
      this.stats.moderationActions += 1;
      await this.deps.config.bumpBannedWordHit(verdict.word.id);
      await this.punish(event, {
        label: '금칙어',
        tempBan: verdict.tempBan,
        warn: verdict.warn,
      });
      return;
    }

    // 2) 스팸 필터
    const spam = this.spamFilter.inspect(event, config.moderation.spam);
    if (spam) {
      this.stats.spamBlocked += 1;
      await this.punish(event, {
        label: spam.label,
        tempBan: spam.escalateToTempBan && config.moderation.allowTempBan,
        warn:
          spam.violations === 1
            ? `${nickname}님, ${spam.label} 은(는) 자제해 주세요.`
            : `${nickname}님, ${spam.label} — ${spam.violations}회째입니다.`,
      });
      return;
    }

    // 3) 포인트 적립
    const earned = this.points.onChat(event.senderChannelId, nickname, config.points);
    if (earned > 0) this.stats.pointsAwarded += earned;
    this.stats.uniqueChatters = this.deps.users.userCount;

    // 4) 첫 채팅 인사
    if (firstEver && config.notifications.greeting.enabled) {
      const greeting = config.notifications.greeting.firstTimeMessage;
      if (greeting.trim()) {
        await this.reply(this.expand(greeting, event, ''));
        this.deps.log.push('system', '첫 채팅 인사', { actor: nickname });
      }
    }

    const content = event.content?.trim() ?? '';
    const prefix = config.general.prefix;

    // 5) 명령어
    if (content.startsWith(prefix)) {
      const [rawName, ...args] = content.slice(prefix.length).trim().split(/\s+/);
      if (rawName) {
        const handled = await this.runCommand(event, rawName, args);
        if (handled) return;
      }
    }

    // 6) 자동응답
    const auto = this.autoResponder.respond(event, config);
    if (auto) {
      this.stats.autoResponsesSent += 1;
      await this.reply(this.expand(auto, event, ''));
      this.deps.log.push('auto', auto, { actor: nickname });
    }
  }

  // ─── API 로 명령 실행 ──────────────────────────────────────────────────────

  /**
   * 채팅을 거치지 않고 명령을 실행해 결과 문자열을 돌려줍니다.
   *
   * 대시보드 미리보기와 외부 연동(오버레이·디스코드)이 쓰는 경로입니다. 핵심은
   * **채팅과 같은 엔진을 탄다**는 것입니다. 별도 구현을 두면 미리보기에서 본
   * 문장과 실제 채팅이 조금씩 달라지고, 그 차이는 반드시 사용자가 먼저 찾습니다.
   *
   * 기본값이 `broadcast: false` 인 이유도 같습니다 — 설정을 시험해 보는 행동이
   * 방송에 새어 나가면 안 됩니다.
   */
  async executeCommand(request: ExecuteCommandRequest): Promise<ExecuteCommandResponse> {
    const startedAt = Date.now();
    const config = this.deps.config.snapshot();

    const actor = request.actor ?? {
      channelId: `api:${this.deps.botChannelId}`,
      nickname: 'API',
      role: 'streamer' as const,
    };

    // 채팅 이벤트를 흉내 냅니다. 엔진 전체가 ChatEvent 하나만 보고 동작하므로,
    // 여기서 제대로 채워 주면 나머지 경로는 실제 채팅과 구분하지 못합니다.
    const event: ChatEvent = {
      channelId: this.deps.botChannelId,
      senderChannelId: actor.channelId,
      chatChannelId: this.lastChatChannel ?? '',
      profile: { nickname: actor.nickname, badges: [], verifiedMark: false },
      userRoleCode: actor.role,
      content: `${config.general.prefix}${request.command} ${request.args.join(' ')}`.trim(),
      emojis: {},
      messageTime: startedAt,
    };

    const name = request.command.replace(new RegExp(`^${escapeRegExp(config.general.prefix)}`), '');
    const outcome = await this.resolveCommand(event, config, name, request.args, request.dryRun);

    if (outcome.output && request.broadcast) {
      await this.reply(outcome.output);
      this.deps.log.push('command', `API: ${config.general.prefix}${name}`, {
        actor: actor.nickname,
      });
    }

    return {
      handled: outcome.handled,
      output: outcome.output,
      source: outcome.source,
      broadcast: request.broadcast && outcome.output.length > 0,
      blockedReason: outcome.blockedReason,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /**
   * 명령 하나를 풀어 결과 문자열을 만듭니다. 전송은 하지 않습니다.
   *
   * `handleChat` 의 5번 단계와 `executeCommand` 가 이 함수를 공유합니다.
   */
  private async resolveCommand(
    event: ChatEvent,
    config: BotConfig,
    name: string,
    args: string[],
    dryRun: boolean
  ): Promise<{
    handled: boolean;
    output: string;
    source: ExecuteCommandResponse['source'];
    blockedReason: string | null;
  }> {
    const key = name.toLowerCase();
    const admin = isAdmin(event, config.permissions) || dryRun;
    const rest = args.join(' ');

    if (['도움말', '명령어', 'help'].includes(key)) {
      return {
        handled: true,
        output: this.helpText(config.general.prefix, admin),
        source: 'help',
        blockedReason: null,
      };
    }

    const game = this.runGame(event, key, args[0], config);
    if (game) {
      return { handled: true, output: game.message, source: 'game', blockedReason: null };
    }

    // 내장이 아무 일도 하지 않았다면(기능이 꺼져 있거나 권한이 없거나) 여기서
    // 끝내지 않고 커스텀 명령으로 넘깁니다. 예전에는 무조건 처리됨으로 봐서,
    // 포인트를 꺼두면 `!포인트`, 신청곡을 꺼두면 `!취소` 같은 이름이 죽은 이름이
    // 되고, 대시보드에서 같은 이름으로 만든 명령이 영영 실행되지 않았습니다.
    const builtin = findBuiltin(name);
    if (builtin && !(builtin.adminOnly && !admin)) {
      const reply = await builtin.run({
        event,
        config,
        args,
        rest,
        isAdmin: admin,
        chzzk: this.deps.chzzk,
        users: this.deps.users,
        songs: this.deps.songs,
        chatters: this.chatters,
        log: this.deps.log,
      });
      if (reply) {
        return { handled: true, output: reply, source: 'builtin', blockedReason: null };
      }
    }

    const outcome = await this.commands.execute(
      event,
      config,
      name,
      args,
      this.audience.isSubscriberDataAvailable
        ? (channelId) => this.audience.isSubscriber(channelId)
        : undefined
    );

    if (!outcome.handled) {
      return {
        handled: false,
        output: '',
        source: 'none',
        blockedReason: `"${name}" 명령을 찾을 수 없습니다.`,
      };
    }

    if (!outcome.reply) {
      // 처리는 했는데 응답이 없다 = 쿨다운에 막혔다는 뜻입니다.
      return {
        handled: true,
        output: '',
        source: 'custom',
        blockedReason: '쿨다운 중입니다.',
      };
    }

    const used = this.deps.config.findCommand(name)?.usedCount ?? 0;
    return {
      handled: true,
      output: this.expand(outcome.reply, event, rest, name, used),
      source: 'custom',
      blockedReason: null,
    };
  }

  /**
   * `!입장` · `!퇴장` 을 처리합니다.
   *
   * @returns 이 메시지를 입장/퇴장 명령으로 소화했으면 true
   */
  private async handleJoinGate(event: ChatEvent, config: BotConfig): Promise<boolean> {
    const content = event.content?.trim() ?? '';
    const prefix = config.general.prefix;
    if (!content.startsWith(prefix)) return false;

    const name = content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    const wantsJoin = (JOIN_COMMANDS as readonly string[]).includes(name);
    const wantsLeave = (LEAVE_COMMANDS as readonly string[]).includes(name);
    if (!wantsJoin && !wantsLeave) return false;

    const nickname = event.profile?.nickname ?? '';

    // 시청자가 봇을 마음대로 부르거나 내보낼 수 있으면 그건 방송 사고입니다.
    // 스트리머·매니저(그리고 설정에서 관리자로 지정한 사람)만 가능합니다.
    if (!canControlBot(event, config.permissions)) {
      this.log.debug(`${nickname} 님이 ${prefix}${name} 을(를) 시도했지만 권한이 없습니다.`);
      return true;
    }

    if (wantsJoin) {
      if (this.joined) {
        await this.reply('이미 입장해 있습니다.');
        return true;
      }
      this.setJoined(true, nickname);
      this.deps.log.push('system', '봇 입장', { actor: nickname });
      await this.reply(`${nickname}님, 입장했습니다. ${prefix}도움말 로 명령어를 확인하세요.`);
      return true;
    }

    if (!this.joined) return true;

    // 퇴장 인사는 상태를 내리기 **전에** 보냅니다. 순서를 바꾸면 아래 reply 가
    // 나가기 전에 타이머가 멈추는 건 상관없지만, 나중에 "퇴장 후 무음" 규칙을
    // 넣었을 때 인사말까지 삼켜집니다.
    await this.reply(`${nickname}님, 퇴장합니다. 다시 부르려면 ${prefix}입장 을 입력하세요.`);
    this.setJoined(false);
    this.deps.log.push('system', '봇 퇴장', { actor: nickname });
    return true;
  }

  /**
   * 채팅으로 들어온 명령을 실행하고 응답까지 보냅니다.
   *
   * 명령을 **푸는** 일은 `resolveCommand` 하나에 모여 있고, 여기서는 채팅에만
   * 필요한 뒤처리(통계·로그·캐시 무효화·전송)를 합니다. API 경로와 같은 함수를
   * 쓰기 때문에 "미리보기와 실제 채팅이 다르다" 는 종류의 버그가 생기지 않습니다.
   */
  private async runCommand(event: ChatEvent, name: string, args: string[]): Promise<boolean> {
    const config = this.deps.config.snapshot();
    const nickname = event.profile?.nickname ?? '';
    const admin = isAdmin(event, config.permissions);
    const key = name.toLowerCase();

    const outcome = await this.resolveCommand(event, config, name, args, false);

    // 방송 설정을 바꾼 뒤에는 $방제/$게임 캐시를 비웁니다.
    if (
      outcome.source === 'builtin' &&
      ['제목', 'title', '방제변경', '카테고리', 'category', 'game', '게임변경'].includes(key)
    ) {
      this.channel.invalidate();
    }

    if (outcome.handled) {
      if (outcome.output) {
        this.stats.commandsRun += 1;
        await this.reply(outcome.output);

        if (outcome.source !== 'help') {
          const line =
            outcome.source === 'game'
              ? outcome.output
              : outcome.source === 'builtin'
                ? `${config.general.prefix}${name} → ${outcome.output}`
                : `${config.general.prefix}${name}`;
          this.deps.log.push('command', line, { actor: nickname });
        }
      }
      return true;
    }

    if (config.general.replyOnUnknownCommand && admin) {
      await this.reply(`"${name}" 명령을 찾을 수 없습니다.`);
      return true;
    }
    return false;
  }

  /** 게임 명령이면 결과(또는 null)를, 게임이 아니면 undefined 를 돌려줍니다. */
  private runGame(
    event: ChatEvent,
    key: string,
    bet: string | undefined,
    config: BotConfig
  ): GameResult | null | undefined {
    // 꺼진 게임의 이름은 아예 잡지 않습니다.
    // 여기서 결과를 돌려주면 같은 이름의 커스텀 명령이 영영 가려집니다.
    // 전체 스위치뿐 아니라 **게임별 스위치**도 함께 봐야 합니다.
    if (!config.games.enabled) return undefined;

    const nickname = event.profile?.nickname ?? '';
    const id = event.senderChannelId;

    if (GAME_COMMAND_NAMES.gamble.some((n) => n === key)) {
      if (!config.games.gambleEnabled) return undefined;
      return this.games.gamble(id, nickname, bet, config.games, config.points);
    }
    if (GAME_COMMAND_NAMES.dice.some((n) => n === key)) {
      if (!config.games.diceEnabled) return undefined;
      return this.games.dice(id, nickname, bet, config.games, config.points);
    }
    if (GAME_COMMAND_NAMES.slots.some((n) => n === key)) {
      if (!config.games.slotsEnabled) return undefined;
      return this.games.slots(id, nickname, bet, config.games, config.points);
    }
    return undefined;
  }

  // ─── 후원 / 구독 ───────────────────────────────────────────────────────────

  async handleDonation(event: DonationEvent): Promise<void> {
    const config = this.deps.config.snapshot();
    const earned = this.points.onDonation(
      event.donatorChannelId,
      event.donatorNickname,
      event.payAmount,
      config.points
    );

    this.deps.log.push('donation', `${event.payAmount}원 후원`, {
      actor: event.donatorNickname,
      detail: event.donationText,
    });

    if (!this.joined || !config.general.enabled || !config.notifications.donationEnabled) return;

    const amount = Number(String(event.payAmount).replace(/[^\d]/g, '')) || 0;
    if (amount < config.notifications.donationMinAmount) return;

    const message = pickRandomVariant(config.notifications.donationMessage)
      .replaceAll('{user}', event.donatorNickname)
      .replaceAll('$닉네임', event.donatorNickname)
      .replaceAll('{amount}', amount.toLocaleString('ko-KR'))
      .replaceAll('$금액', amount.toLocaleString('ko-KR'))
      .replaceAll('{message}', event.donationText ?? '')
      .replaceAll('{points}', formatPoints(earned));

    await this.reply(message);
  }

  async handleSubscription(event: SubscriptionEvent): Promise<void> {
    const config = this.deps.config.snapshot();

    // 구독자 전용 명령이 곧바로 통하도록, 목록 갱신을 기다리지 않고 반영합니다.
    this.audience.noteSubscription({
      channelId: event.subscriberChannelId,
      nickname: event.subscriberNickname,
      month: event.month,
      tierNo: event.tierNo,
    });

    this.points.onSubscription(
      event.subscriberChannelId,
      event.subscriberNickname,
      event.month,
      config.points
    );

    this.deps.log.push('subscription', `${event.month}개월 구독 (티어${event.tierNo})`, {
      actor: event.subscriberNickname,
    });

    if (!this.joined || !config.general.enabled || !config.notifications.subscriptionEnabled)
      return;

    const message = pickRandomVariant(config.notifications.subscriptionMessage)
      .replaceAll('{user}', event.subscriberNickname)
      .replaceAll('$닉네임', event.subscriberNickname)
      .replaceAll('{month}', String(event.month))
      .replaceAll('$개월', String(event.month))
      .replaceAll('{tier}', String(event.tierNo));

    await this.reply(message);
  }

  // ─── 공통 ──────────────────────────────────────────────────────────────────

  /** 제재 실행. 숨기기 → (필요시) 임시제한 → 경고 순서. */
  private async punish(
    event: ChatEvent,
    action: { label: string; tempBan: boolean; warn: string | null }
  ): Promise<void> {
    try {
      await this.deps.chzzk.chat.blindMessage({
        chatChannelId: event.chatChannelId,
        messageTime: event.messageTime,
        senderChannelId: event.senderChannelId,
      });
    } catch (error) {
      // 스트리머 계정이 아니면 400 이 납니다. 봇을 죽이지 않고 남깁니다.
      this.log.warn('메시지 숨기기에 실패했습니다.', error);
    }

    if (action.tempBan) {
      try {
        await this.deps.chzzk.restrictions.temporaryRestrict({
          targetChannelId: event.senderChannelId,
          chatChannelId: event.chatChannelId,
        });
      } catch (error) {
        this.log.warn('임시 제한에 실패했습니다.', error);
      }
    }

    this.deps.log.push('moderation', `${action.label} 차단${action.tempBan ? ' + 임시제한' : ''}`, {
      actor: event.profile?.nickname,
      detail: event.content,
    });

    if (action.warn) await this.reply(action.warn);
  }

  /**
   * 랜덤 응답을 고른 뒤 변수를 채웁니다.
   *
   * `$카운트` 는 **그 명령어가 실제로 실행된 횟수**입니다. 예전에는 전역
   * commandsRun 을 넣었는데, 그 값은 쿨다운에 막힌 호출까지 세고 다른 명령의
   * 실행에도 올라갔습니다. `!데스` 를 연타하면 응답 하나에 카운터가 10씩 뛰었습니다.
   */
  private expand(
    template: string,
    event: ChatEvent,
    query: string,
    commandName = '',
    commandCount = 0
  ): string {
    const picked = pickRandomVariant(template);

    const userKey = `${commandName}:${event.senderChannelId}`;
    const userCount = (this.userCommandCounts.get(userKey) ?? 0) + 1;
    if (commandName) this.userCommandCounts.set(userKey, userCount);

    return expandVariables(picked, {
      event,
      query,
      commandCount,
      userCount,
      channel: this.channel,
      users: this.deps.users,
      botStartedAt: this.stats.startedAt,
    });
  }

  /** 주기 메시지에는 호출자가 없어 방송 관련 변수만 채웁니다. */
  private expandForTimer(template: string): string {
    return pickRandomVariant(template)
      .replace(/\$방제|\{방제\}|\$title/g, this.channel.liveTitle)
      .replace(/\$게임|\{게임\}|\$카테고리/g, this.channel.liveCategory);
  }

  private helpText(prefix: string, admin: boolean): string {
    const config = this.deps.config.snapshot();
    const custom = config.commands.filter((c) => c.enabled).map((c) => `${prefix}${c.name}`);
    const builtins = BUILTIN_COMMANDS.filter((c) => admin || !c.adminOnly)
      .map((c) => `${prefix}${c.names[0]}`)
      .slice(0, 8);

    const all = [...custom, ...builtins];
    return all.length > 0 ? `사용 가능: ${all.join(' ')}` : '등록된 명령어가 없습니다.';
  }

  /**
   * 채팅 응답. 실패해도 이벤트 처리를 계속하기 위해 오류를 흡수합니다.
   *
   * 실패를 알아야 하는 호출자(주기 메시지 등)는 `sendOrThrow` 를 쓰세요.
   * 예전에는 이쪽만 있어서, 전송이 400 으로 실패했는데도 스케줄러가 성공으로 보고
   * "주기 메시지를 보냈습니다" 라는 거짓 로그를 남겼습니다.
   */
  private async reply(message: string): Promise<void> {
    try {
      await this.sendOrThrow(message);
    } catch (error) {
      this.log.error('응답 전송에 실패했습니다.', error);
      this.deps.log.push('error', '메시지 전송 실패', { detail: describeError(error) });
    }
  }

  /** 실패를 그대로 던집니다. */
  private async sendOrThrow(message: string): Promise<void> {
    if (!message.trim()) return;
    await this.sender.send(message);
  }
}

/** 접두사를 정규식으로 쓰기 전에 특수문자를 막습니다. `?` 나 `+` 를 접두사로 쓸 수 있습니다. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 로그에 남길 짧은 사유 */
function describeError(error: unknown): string {
  if (error instanceof ChzzkApiError)
    return error.message.split('—').pop()?.trim() ?? error.message;
  return error instanceof Error ? error.message : String(error);
}
