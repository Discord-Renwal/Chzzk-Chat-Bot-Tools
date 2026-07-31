import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { noopLogger, type Logger } from '@chzzk-bot/logger';
import {
  botConfig,
  starterConfig,
  type AutoResponse,
  type BannedWord,
  type BotConfig,
  type CustomCommand,
} from '@chzzk-bot/contracts';
import type { ConfigSource } from '../ports.js';

/**
 * 설정을 JSON 파일 하나에 보관하는 `ConfigSource` 구현.
 *
 * 로컬 단일 채널 실행과 단위 테스트가 씁니다. 서비스로 돌 때는 Postgres 를 보는
 * 구현(`apps/core/src/adapters/prismaConfigSource.ts`)이 같은 자리에 꽂힙니다.
 *
 * 쓰기는 임시 파일 + rename 으로 원자적으로 처리해, 저장 도중 죽어도 설정이
 * 반쯤 쓰인 채 남지 않습니다.
 */
export class JsonConfigStore extends EventEmitter implements ConfigSource {
  private readonly filePath: string;
  private readonly log: Logger;
  private config: BotConfig;
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(filePath: string, config: BotConfig, logger: Logger) {
    super();
    this.filePath = filePath;
    this.config = config;
    this.log = logger.child('config');
  }

  /** 파일을 읽어 스토어를 엽니다. 파일이 없으면 예시 설정으로 새로 만듭니다. */
  static async open(
    filePath = 'data/config.json',
    options: { logger?: Logger } = {}
  ): Promise<JsonConfigStore> {
    const path = resolve(filePath);
    const log = options.logger ?? noopLogger;

    let config: BotConfig;
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = botConfig.safeParse(JSON.parse(raw));
      if (parsed.success) {
        config = parsed.data;
      } else {
        // 설정이 깨졌을 때 조용히 기본값으로 덮으면 사용자가 작업물을 잃습니다.
        // 무엇이 잘못됐는지 알리고 멈추는 편이 낫습니다.
        const detail = parsed.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(`설정 파일(${path})이 올바르지 않습니다.\n${detail}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      config = starterConfig();
      log.info(`설정 파일이 없어 예시 설정으로 새로 만듭니다: ${path}`);
      const store = new JsonConfigStore(path, deepFreeze(config), log);
      await store.persist();
      return store;
    }

    return new JsonConfigStore(path, deepFreeze(config), log);
  }

  get path(): string {
    return this.filePath;
  }

  /**
   * 현재 설정. **읽기 전용이며 고치면 안 됩니다** (얼려 두어 시도하면 실패합니다).
   *
   * 예전에는 매번 structuredClone 으로 깊은 복사본을 만들어 줬습니다. 안전하긴 했지만
   * 채팅 1건마다 2~3번 불리는 경로여서, 명령어·금칙어가 수십 개만 돼도 메시지당
   * 수 밀리초를 복사에만 썼습니다(측정값 1.37ms/회). 설정은 바뀔 때마다 통째로
   * 새 객체로 교체되므로, 복사 대신 그 순간의 객체를 그대로 돌려주면 충분합니다.
   *
   * 값을 바꾸려면 `update()` 를 쓰세요. 그쪽은 여전히 복사본 위에서 작업합니다.
   */
  snapshot(): BotConfig {
    return this.config;
  }

  /**
   * 설정을 통째로 교체합니다. 검증에 실패하면 아무것도 바꾸지 않고 throw 합니다.
   */
  async replace(next: unknown): Promise<BotConfig> {
    // 얼려서 내보냅니다. 실수로 스냅샷을 고치면 조용히 어긋나는 대신 바로 드러납니다.
    const parsed = deepFreeze(botConfig.parse(next));
    this.config = parsed;
    await this.persist();
    this.emit('change', parsed);
    return parsed;
  }

  /**
   * 파일을 다시 읽습니다.
   *
   * 이 구현에서는 우리가 유일한 필자라 사실상 필요 없지만, `ConfigSource` 는
   * 여러 프로세스가 같은 설정을 보는 경우(대시보드가 DB 를 고치고 봇이 읽는)를
   * 전제하므로 인터페이스에 있습니다. 여기서는 디스크를 정직하게 다시 읽습니다.
   */
  async refresh(): Promise<BotConfig> {
    const raw = await readFile(this.filePath, 'utf8');
    const next = deepFreeze(botConfig.parse(JSON.parse(raw)));
    this.config = next;
    this.emit('change', next);
    return next;
  }

  /** 일부만 수정합니다. */
  async update(mutate: (draft: BotConfig) => void): Promise<BotConfig> {
    // 얼린 객체는 직접 못 고치므로 여기서만 복사본을 뜹니다. 변경은 드물어 비용이 문제되지 않습니다.
    const draft = structuredClone(this.config);
    mutate(draft);
    return this.replace(draft);
  }

  // ─── 명령어 ────────────────────────────────────────────────────────────────

  findCommand(nameOrAlias: string): CustomCommand | undefined {
    const key = nameOrAlias.toLowerCase();
    return this.config.commands.find(
      (c) => c.name.toLowerCase() === key || c.aliases.some((a) => a.toLowerCase() === key)
    );
  }

  async upsertCommand(input: Partial<CustomCommand> & { name: string }): Promise<CustomCommand> {
    const id = input.id ?? `cmd_${randomUUID().slice(0, 8)}`;
    let saved!: CustomCommand;

    await this.update((draft) => {
      const index = draft.commands.findIndex((c) => c.id === id);
      const base = index >= 0 ? draft.commands[index] : undefined;
      saved = { ...(base ?? {}), ...input, id } as CustomCommand;
      if (index >= 0) draft.commands[index] = saved;
      else draft.commands.push(saved);
    });

    return saved;
  }

  async deleteCommand(id: string): Promise<boolean> {
    let removed = false;
    await this.update((draft) => {
      const before = draft.commands.length;
      draft.commands = draft.commands.filter((c) => c.id !== id);
      removed = draft.commands.length < before;
    });
    return removed;
  }

  /** `!멤버 빅헤드,9구진` 처럼 채팅에서 목록을 갱신할 때 씁니다. */
  async setCommandItems(id: string, items: string[]): Promise<void> {
    await this.update((draft) => {
      const command = draft.commands.find((c) => c.id === id);
      if (command) command.items = items;
    });
  }

  async bumpCommandUsage(id: string, counterDelta = 0): Promise<number> {
    let count = 0;
    await this.update((draft) => {
      const command = draft.commands.find((c) => c.id === id);
      if (!command) return;
      command.usedCount += 1;
      if (counterDelta) command.count += counterDelta;
      count = command.count;
    });
    return count;
  }

  // ─── 자동응답 ──────────────────────────────────────────────────────────────

  async upsertAutoResponse(
    input: Partial<AutoResponse> & { pattern: string; response: string }
  ): Promise<AutoResponse> {
    const id = input.id ?? `ar_${randomUUID().slice(0, 8)}`;
    let saved!: AutoResponse;

    await this.update((draft) => {
      const index = draft.autoResponses.findIndex((a) => a.id === id);
      const base = index >= 0 ? draft.autoResponses[index] : undefined;
      saved = { ...(base ?? {}), ...input, id } as AutoResponse;
      if (index >= 0) draft.autoResponses[index] = saved;
      else draft.autoResponses.push(saved);
    });

    return saved;
  }

  async deleteAutoResponse(id: string): Promise<boolean> {
    let removed = false;
    await this.update((draft) => {
      const before = draft.autoResponses.length;
      draft.autoResponses = draft.autoResponses.filter((a) => a.id !== id);
      removed = draft.autoResponses.length < before;
    });
    return removed;
  }

  // ─── 금칙어 ────────────────────────────────────────────────────────────────

  async upsertBannedWord(input: Partial<BannedWord> & { pattern: string }): Promise<BannedWord> {
    const id = input.id ?? `bw_${randomUUID().slice(0, 8)}`;
    let saved!: BannedWord;

    await this.update((draft) => {
      const index = draft.moderation.words.findIndex((w) => w.id === id);
      const base = index >= 0 ? draft.moderation.words[index] : undefined;
      saved = { ...(base ?? {}), ...input, id } as BannedWord;
      if (index >= 0) draft.moderation.words[index] = saved;
      else draft.moderation.words.push(saved);
    });

    return saved;
  }

  async deleteBannedWord(id: string): Promise<boolean> {
    let removed = false;
    await this.update((draft) => {
      const before = draft.moderation.words.length;
      draft.moderation.words = draft.moderation.words.filter((w) => w.id !== id);
      removed = draft.moderation.words.length < before;
    });
    return removed;
  }

  async bumpBannedWordHit(id: string): Promise<void> {
    await this.update((draft) => {
      const word = draft.moderation.words.find((w) => w.id === id);
      if (word) word.hitCount += 1;
    });
  }

  // ─── 저장 ──────────────────────────────────────────────────────────────────

  /**
   * 쓰기를 직렬화합니다. 대시보드 저장과 채팅 명령이 동시에 들어와도
   * 뒤엉킨 내용이 파일에 남지 않습니다.
   */
  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      await rename(tmp, this.filePath);
      this.log.debug('설정을 저장했습니다.');
    });
    return this.writeQueue;
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
