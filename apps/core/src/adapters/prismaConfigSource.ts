import { EventEmitter } from 'node:events';
import type { BotConfig, CustomCommand } from '@chzzk-bot/contracts';
import type { ConfigSource } from '@chzzk-bot/bot-engine';
import type { BotConfigRepository } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * Postgres 를 보는 `ConfigSource`.
 *
 * 채팅 1건마다 설정을 읽는데 그때마다 DB 를 때리면 방송 하나가 초당 수십 번의
 * 쿼리를 만듭니다. 그래서 **메모리에 캐시**하고, 대시보드가 바꾼 값은 주기적인
 * 새로고침 또는 API 가 보내는 명시적 무효화로 반영합니다.
 *
 * 반대로 봇이 채팅 중에 바꾸는 값(목록 갱신·카운터·금칙어 적발 수)은 즉시
 * DB 에 씁니다. 이쪽은 드물게 일어나고, 잃어버리면 사용자가 바로 알아챕니다.
 */
export class PrismaConfigSource extends EventEmitter implements ConfigSource {
  private config: BotConfig;
  private readonly log: Logger;
  private refreshing: Promise<BotConfig> | undefined;

  private constructor(
    private readonly repository: BotConfigRepository,
    private readonly tenantId: string,
    initial: BotConfig,
    logger: Logger
  ) {
    super();
    this.config = deepFreeze(initial);
    this.log = logger.child('config');
  }

  static async open(
    repository: BotConfigRepository,
    tenantId: string,
    logger: Logger = noopLogger
  ): Promise<PrismaConfigSource> {
    const initial = await repository.load(tenantId);
    return new PrismaConfigSource(repository, tenantId, initial, logger);
  }

  snapshot(): BotConfig {
    return this.config;
  }

  findCommand(nameOrAlias: string): CustomCommand | undefined {
    const key = nameOrAlias.toLowerCase();
    return this.config.commands.find(
      (c) => c.name.toLowerCase() === key || c.aliases.some((a) => a.toLowerCase() === key)
    );
  }

  /**
   * DB 에서 다시 읽습니다.
   *
   * 동시에 여러 번 불려도 조회는 한 번만 합니다. 대시보드에서 설정을 저장하면
   * 무효화 신호가 여러 경로로 겹쳐 들어올 수 있는데, 그때마다 전체 설정을
   * 다시 읽으면 낭비입니다.
   */
  async refresh(): Promise<BotConfig> {
    this.refreshing ??= this.repository
      .load(this.tenantId)
      .then((next) => {
        this.config = deepFreeze(next);
        this.emit('change', this.config);
        return this.config;
      })
      .finally(() => {
        this.refreshing = undefined;
      });

    return this.refreshing;
  }

  async setCommandItems(id: string, items: string[]): Promise<void> {
    await this.repository.setCommandItems(this.tenantId, id, items);
    await this.refresh();
  }

  async bumpCommandUsage(id: string, counterDelta = 0): Promise<number> {
    const count = await this.repository.bumpCommandUsage(this.tenantId, id, counterDelta);

    // 캐시의 카운터만 손으로 맞춥니다. `$카운트` 치환자가 바로 다음 줄에서 이
    // 값을 읽는데, 전체 새로고침을 기다리면 한 박자 늦은 숫자가 나갑니다.
    this.config = deepFreeze({
      ...this.config,
      commands: this.config.commands.map((c) =>
        c.id === id ? { ...c, usedCount: c.usedCount + 1, count } : c
      ),
    });

    return count;
  }

  async bumpBannedWordHit(id: string): Promise<void> {
    await this.repository.bumpBannedWordHit(this.tenantId, id);
    this.config = deepFreeze({
      ...this.config,
      moderation: {
        ...this.config.moderation,
        words: this.config.moderation.words.map((w) =>
          w.id === id ? { ...w, hitCount: w.hitCount + 1 } : w
        ),
      },
    });
  }

  async upsertCommand(input: Partial<CustomCommand> & { name: string }): Promise<CustomCommand> {
    const saved = await this.repository.upsertCommand(this.tenantId, input);
    await this.refresh();
    this.log.debug(`명령어 저장: ${saved.name}`);
    return saved;
  }
}

/**
 * 중첩된 객체까지 얼립니다.
 *
 * 설정이 바뀔 때 한 번만 도는 비용이라 무시할 만하고, 대신 스냅샷을 실수로
 * 고치는 코드를 즉시 드러내 줍니다. 얼리지 않으면 한 곳에서 몰래 고친 값이
 * 저장 없이 메모리에만 남아, 재시작하면 사라지는 유령 버그가 됩니다.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
