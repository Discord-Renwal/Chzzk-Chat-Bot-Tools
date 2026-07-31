import {
  autoResponse as autoResponseSchema,
  bannedWord as bannedWordSchema,
  botConfig as botConfigSchema,
  customCommand as customCommandSchema,
  defaultConfig,
  timerMessage as timerMessageSchema,
  type AutoResponse,
  type BannedWord,
  type BotConfig,
  type CustomCommand,
  type TimerMessage,
} from '@chzzk-bot/contracts';
import type { PrismaClient } from '../client.js';
import type {
  AutoResponse as DbAutoResponse,
  BannedWord as DbBannedWord,
  BotSettings as DbBotSettings,
  Command as DbCommand,
  TimerMessage as DbTimerMessage,
} from '../client.js';

/**
 * DB 에 흩어진 봇 설정을 하나의 `BotConfig` 로 조립하고 되돌립니다.
 *
 * 봇 엔진과 대시보드는 예나 지금이나 "설정 객체 하나" 만 압니다. 저장 방식이
 * JSON 파일에서 Postgres 로 바뀐 사실을 그쪽에 알릴 이유가 없어서, 그 변환을
 * 전부 이 파일 안에 가둡니다. 여기 밖으로 Prisma 타입이 새어 나가면 안 됩니다.
 */
export class BotConfigRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** 채널 하나의 전체 설정. 아직 없으면 기본값으로 만들어 돌려줍니다. */
  async load(tenantId: string): Promise<BotConfig> {
    const [settings, commands, autoResponses, bannedWords, timers] = await Promise.all([
      this.prisma.botSettings.findUnique({ where: { tenantId } }),
      this.prisma.command.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.autoResponse.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.bannedWord.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.timerMessage.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    ]);

    if (!settings) return this.initialize(tenantId);

    return assemble(settings, commands, autoResponses, bannedWords, timers);
  }

  /** 채널을 만들 때 한 번 부릅니다. 이미 있으면 그대로 둡니다. */
  async initialize(tenantId: string, seed: BotConfig = defaultConfig()): Promise<BotConfig> {
    await this.prisma.botSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...toSettingsColumns(seed) },
      update: {},
    });

    // 예시 설정으로 시작하는 경우에만 목록이 채워져 있습니다.
    if (seed.commands.length > 0) {
      await this.prisma.command.createMany({
        data: seed.commands.map((c) => ({ tenantId, ...toCommandColumns(c) })),
        skipDuplicates: true,
      });
    }
    if (seed.autoResponses.length > 0) {
      await this.prisma.autoResponse.createMany({
        data: seed.autoResponses.map((a) => ({ tenantId, ...toAutoResponseColumns(a) })),
      });
    }
    if (seed.moderation.words.length > 0) {
      await this.prisma.bannedWord.createMany({
        data: seed.moderation.words.map((w) => ({ tenantId, ...toBannedWordColumns(w) })),
      });
    }
    if (seed.timers.length > 0) {
      await this.prisma.timerMessage.createMany({
        data: seed.timers.map((t) => ({ tenantId, ...toTimerColumns(t) })),
      });
    }

    return this.load(tenantId);
  }

  /**
   * 설정 섹션 하나를 통째로 바꿉니다.
   *
   * `moderation` 은 금칙어 목록을 빼고 저장합니다 — 그쪽은 별도 테이블이고,
   * 함께 덮어쓰면 다른 화면에서 방금 추가한 금칙어가 조용히 사라집니다.
   */
  async saveSettings(tenantId: string, config: BotConfig, updatedById?: string): Promise<void> {
    const columns = toSettingsColumns(config);
    await this.prisma.botSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...columns, updatedById: updatedById ?? null },
      update: { ...columns, updatedById: updatedById ?? null },
    });
  }

  // ─── 명령어 ────────────────────────────────────────────────────────────────

  async findCommandByName(tenantId: string, nameOrAlias: string): Promise<CustomCommand | null> {
    const key = nameOrAlias.toLowerCase();
    // 별칭까지 봐야 하므로 이름만으로는 못 찾습니다. 채널당 수십 개 규모라
    // 전부 읽어 메모리에서 거르는 편이 인덱스를 늘리는 것보다 단순합니다.
    const rows = await this.prisma.command.findMany({ where: { tenantId } });
    const hit = rows.find(
      (c) => c.name.toLowerCase() === key || c.aliases.some((a) => a.toLowerCase() === key)
    );
    return hit ? toCommand(hit) : null;
  }

  async upsertCommand(
    tenantId: string,
    input: Partial<CustomCommand> & { name: string }
  ): Promise<CustomCommand> {
    const merged = customCommandSchema.parse({ id: input.id ?? 'pending', ...input });
    const columns = toCommandColumns(merged);

    const row = input.id
      ? await this.prisma.command.update({ where: { id: input.id }, data: columns })
      : await this.prisma.command.create({ data: { tenantId, ...columns } });

    return toCommand(row);
  }

  async deleteCommand(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.command.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  /** `!멤버 빅헤드,9구진` 처럼 채팅에서 목록을 갱신할 때 씁니다. */
  async setCommandItems(tenantId: string, id: string, items: string[]): Promise<void> {
    await this.prisma.command.updateMany({ where: { id, tenantId }, data: { items } });
  }

  /**
   * 사용 횟수를 올립니다.
   *
   * 읽고-더해서-쓰기 대신 `increment` 를 쓰는 게 중요합니다. 채팅은 동시에
   * 들어오기 때문에, 읽은 값에 1을 더해 쓰면 같은 순간의 다른 호출이 덮어써서
   * 카운터가 실제 호출 수보다 적게 남습니다.
   */
  async bumpCommandUsage(tenantId: string, id: string, counterDelta = 0): Promise<number> {
    const [row] = await this.prisma.$transaction([
      this.prisma.command.update({
        where: { id },
        data: {
          usedCount: { increment: 1 },
          ...(counterDelta ? { count: { increment: counterDelta } } : {}),
        },
      }),
    ]);
    return row.tenantId === tenantId ? row.count : 0;
  }

  // ─── 자동응답 ──────────────────────────────────────────────────────────────

  async upsertAutoResponse(
    tenantId: string,
    input: Partial<AutoResponse> & { pattern: string; response: string }
  ): Promise<AutoResponse> {
    const merged = autoResponseSchema.parse({ id: input.id ?? 'pending', ...input });
    const columns = toAutoResponseColumns(merged);

    const row = input.id
      ? await this.prisma.autoResponse.update({ where: { id: input.id }, data: columns })
      : await this.prisma.autoResponse.create({ data: { tenantId, ...columns } });

    return toAutoResponse(row);
  }

  async deleteAutoResponse(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.autoResponse.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  // ─── 금칙어 ────────────────────────────────────────────────────────────────

  async upsertBannedWord(
    tenantId: string,
    input: Partial<BannedWord> & { pattern: string }
  ): Promise<BannedWord> {
    const merged = bannedWordSchema.parse({ id: input.id ?? 'pending', ...input });
    const columns = toBannedWordColumns(merged);

    const row = input.id
      ? await this.prisma.bannedWord.update({ where: { id: input.id }, data: columns })
      : await this.prisma.bannedWord.create({ data: { tenantId, ...columns } });

    return toBannedWord(row);
  }

  async deleteBannedWord(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.bannedWord.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  async bumpBannedWordHit(tenantId: string, id: string): Promise<void> {
    await this.prisma.bannedWord.updateMany({
      where: { id, tenantId },
      data: { hitCount: { increment: 1 } },
    });
  }

  // ─── 주기 메시지 ───────────────────────────────────────────────────────────

  async upsertTimer(
    tenantId: string,
    input: Partial<TimerMessage> & { message: string }
  ): Promise<TimerMessage> {
    const merged = timerMessageSchema.parse({ id: input.id ?? 'pending', ...input });
    const columns = toTimerColumns(merged);

    const row = input.id
      ? await this.prisma.timerMessage.update({ where: { id: input.id }, data: columns })
      : await this.prisma.timerMessage.create({ data: { tenantId, ...columns } });

    return toTimer(row);
  }

  async deleteTimer(tenantId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.timerMessage.deleteMany({ where: { id, tenantId } });
    return count > 0;
  }

  // ─── 사용량 (플랜 한도 검사용) ─────────────────────────────────────────────

  async counts(tenantId: string): Promise<{
    commands: number;
    autoResponses: number;
    bannedWords: number;
    timers: number;
  }> {
    const [commands, autoResponses, bannedWords, timers] = await Promise.all([
      this.prisma.command.count({ where: { tenantId } }),
      this.prisma.autoResponse.count({ where: { tenantId } }),
      this.prisma.bannedWord.count({ where: { tenantId } }),
      this.prisma.timerMessage.count({ where: { tenantId } }),
    ]);
    return { commands, autoResponses, bannedWords, timers };
  }
}

// ─── 매핑 ─────────────────────────────────────────────────────────────────────

function assemble(
  settings: DbBotSettings,
  commands: DbCommand[],
  autoResponses: DbAutoResponse[],
  bannedWords: DbBannedWord[],
  timers: DbTimerMessage[]
): BotConfig {
  // 저장된 Json 이 손상됐다면 여기서 드러납니다. 조용히 기본값으로 덮으면
  // 사용자가 몇 달 다듬은 설정이 흔적 없이 사라집니다.
  return botConfigSchema.parse({
    version: 1,
    general: settings.general,
    permissions: settings.permissions,
    moderation: {
      ...(settings.moderation as object),
      words: bannedWords.map(toBannedWord),
    },
    points: settings.points,
    songs: settings.songs,
    games: settings.games,
    notifications: settings.notifications,
    commands: commands.map(toCommand),
    autoResponses: autoResponses.map(toAutoResponse),
    timers: timers.map(toTimer),
  });
}

function toSettingsColumns(config: BotConfig) {
  const { words: _words, ...moderation } = config.moderation;
  return {
    general: config.general,
    permissions: config.permissions,
    moderation,
    points: config.points,
    songs: config.songs,
    games: config.games,
    notifications: config.notifications,
  };
}

function toCommand(row: DbCommand): CustomCommand {
  return customCommandSchema.parse({
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    type: row.kind,
    response: row.response,
    items: row.items,
    count: row.count,
    useRoles: row.useRoles,
    editRoles: row.editRoles,
    subscriberOnly: row.subscriberOnly,
    cooldownSec: row.cooldownSec,
    enabled: row.enabled,
    usedCount: row.usedCount,
  });
}

function toCommandColumns(command: CustomCommand) {
  return {
    name: command.name,
    aliases: command.aliases,
    kind: command.type,
    response: command.response,
    items: command.items,
    count: command.count,
    useRoles: command.useRoles,
    editRoles: command.editRoles,
    subscriberOnly: command.subscriberOnly,
    cooldownSec: command.cooldownSec,
    enabled: command.enabled,
    usedCount: command.usedCount,
  };
}

function toAutoResponse(row: DbAutoResponse): AutoResponse {
  return autoResponseSchema.parse({
    id: row.id,
    label: row.label,
    pattern: row.pattern,
    mode: row.mode,
    caseSensitive: row.caseSensitive,
    response: row.response,
    cooldownSec: row.cooldownSec,
    chancePercent: row.chancePercent,
    enabled: row.enabled,
  });
}

function toAutoResponseColumns(item: AutoResponse) {
  return {
    label: item.label,
    pattern: item.pattern,
    mode: item.mode,
    caseSensitive: item.caseSensitive,
    response: item.response,
    cooldownSec: item.cooldownSec,
    chancePercent: item.chancePercent,
    enabled: item.enabled,
  };
}

function toBannedWord(row: DbBannedWord): BannedWord {
  return bannedWordSchema.parse({
    id: row.id,
    pattern: row.pattern,
    mode: row.mode,
    caseSensitive: row.caseSensitive,
    action: row.action,
    warnMessage: row.warnMessage,
    enabled: row.enabled,
    hitCount: row.hitCount,
  });
}

function toBannedWordColumns(word: BannedWord) {
  return {
    pattern: word.pattern,
    mode: word.mode,
    caseSensitive: word.caseSensitive,
    action: word.action,
    warnMessage: word.warnMessage,
    enabled: word.enabled,
    hitCount: word.hitCount,
  };
}

function toTimer(row: DbTimerMessage): TimerMessage {
  return timerMessageSchema.parse({
    id: row.id,
    label: row.label,
    message: row.message,
    intervalMinutes: row.intervalMinutes,
    minChatsSinceLast: row.minChatsSinceLast,
    enabled: row.enabled,
  });
}

function toTimerColumns(timer: TimerMessage) {
  return {
    label: timer.label,
    message: timer.message,
    intervalMinutes: timer.intervalMinutes,
    minChatsSinceLast: timer.minChatsSinceLast,
    enabled: timer.enabled,
  };
}
