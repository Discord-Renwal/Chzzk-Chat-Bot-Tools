import type { ChzzkClient } from '@chzzk-bot/chzzk-sdk';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { ViewerStore } from '../ports.js';
import type { CustomCommand } from '@chzzk-bot/contracts';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * 방송 정보 캐시.
 *
 * $방제 / $게임 은 매번 API 를 부르면 분당 쿼터를 금방 태웁니다.
 * 60초 캐시로 충분합니다 — 방송 제목이 초 단위로 바뀌지는 않으니까요.
 */
export class ChannelContext {
  private title = '';
  private category = '';
  private fetchedAt = 0;
  private inflight: Promise<void> | undefined;
  private readonly log: Logger;

  constructor(
    private readonly chzzk: ChzzkClient,
    private readonly ttlMs = 60_000,
    logger?: Logger
  ) {
    this.log = (logger ?? noopLogger).child('channel');
  }

  /** 캐시가 오래됐으면 갱신합니다. 실패해도 예전 값을 계속 씁니다. */
  async refresh(): Promise<void> {
    if (Date.now() - this.fetchedAt < this.ttlMs) return;
    // 동시에 여러 명령이 들어와도 한 번만 부릅니다.
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<void> {
    try {
      const setting = await this.chzzk.lives.getSetting();
      this.title = setting.defaultLiveTitle ?? '';
      this.category = setting.category?.categoryValue ?? '';
      this.fetchedAt = Date.now();
    } catch (error) {
      // 스트리머 계정이 아니면 실패합니다. 변수는 빈 값으로 두고 넘어갑니다.
      this.fetchedAt = Date.now();
      this.log.debug('방송 설정을 가져오지 못했습니다.', error);
    }
  }

  /** 방송 설정을 바꾼 직후 캐시를 무효화합니다. */
  invalidate(): void {
    this.fetchedAt = 0;
  }

  get liveTitle(): string {
    return this.title;
  }
  get liveCategory(): string {
    return this.category;
  }
}

export interface VariableContext {
  event: ChatEvent;
  /** 명령어 뒤에 붙은 인자 전체 ($변수) */
  query: string;
  /** 명령어 전체 실행 횟수 ($카운트) */
  commandCount: number;
  /** 이 사람의 개인 카운터 ($유저카운트) */
  userCount: number;
  channel: ChannelContext;
  users: ViewerStore;
  botStartedAt: number;
}

/**
 * 국내 봇들이 공통으로 쓰는 변수 표기를 따릅니다.
 * `$이름` 과 `{이름}` 을 모두 받아들여, 기존 설정도 그대로 동작합니다.
 */
function resolvers(ctx: VariableContext): Record<string, () => string> {
  const nickname = ctx.event.profile?.nickname ?? '';
  const record = ctx.users.get(ctx.event.senderChannelId);

  return {
    // 사람
    닉네임: () => nickname,
    name: () => nickname,
    user: () => nickname,

    // 방송
    방제: () => ctx.channel.liveTitle,
    title: () => ctx.channel.liveTitle,
    게임: () => ctx.channel.liveCategory,
    카테고리: () => ctx.channel.liveCategory,
    game: () => ctx.channel.liveCategory,

    // 시간
    시간: () => new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
    time: () => new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
    날짜: () => new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }),
    업타임: () => formatDuration(Date.now() - ctx.botStartedAt),
    uptime: () => formatDuration(Date.now() - ctx.botStartedAt),

    // 카운터
    카운트: () => String(ctx.commandCount),
    count: () => String(ctx.commandCount),
    유저카운트: () => String(ctx.userCount),
    usercount: () => String(ctx.userCount),

    // 포인트 / 활동
    포인트: () => String(record?.points ?? 0),
    point: () => String(record?.points ?? 0),
    채팅수: () => String(record?.chatCount ?? 0),
    출석체크: () => String(record?.attendanceStreak ?? 0),
    attendance: () => String(record?.attendanceStreak ?? 0),

    // 입력값
    변수: () => ctx.query,
    query: () => ctx.query,
  };
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `$이름` 또는 `{이름}` 형태를 실제 값으로 바꿉니다.
 *
 * 한국어에는 단어 경계가 없어서 `$카운트번째` 처럼 변수 뒤에 조사나 말이 바로 붙습니다.
 * `[가-힣]+` 로 잡으면 "카운트번째" 를 통째로 변수명으로 읽어 실패하므로,
 * **아는 변수명 중 가장 긴 것부터** 맞춰 봅니다.
 */
export function expandVariables(template: string, ctx: VariableContext): string {
  const table = resolvers(ctx);
  const names = Object.keys(table).sort((a, b) => b.length - a.length);
  const alternation = names.map(escapeRegex).join('|');

  // $이름 · {이름} 둘 다 지원하되, 아는 이름에만 반응합니다.
  const pattern = new RegExp(`\\$(${alternation})|\\{(${alternation})\\}`, 'gi');

  return template.replace(
    pattern,
    (whole, dollar: string | undefined, brace: string | undefined) => {
      const key = (dollar ?? brace ?? '').toLowerCase();
      const resolve = table[key] ?? table[dollar ?? brace ?? ''];
      // 모르는 변수는 원문 그대로 둡니다. 오타를 조용히 지워버리면 디버깅이 어렵습니다.
      return resolve ? resolve() : whole;
    }
  );
}

/**
 * `안녕|반가워|hi` 처럼 `|` 로 구분된 후보 중 하나를 고릅니다.
 * 변수 치환보다 먼저 적용해, 고른 문장 안의 변수만 계산되게 합니다.
 */
export function pickRandomVariant(template: string, random: () => number = Math.random): string {
  if (!template.includes('|')) return template;

  const variants = template
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
  if (variants.length <= 1) return template;

  return variants[Math.floor(random() * variants.length)] ?? template;
}

/** 목록형 명령의 `{value}` `{n}` 처럼 명령 고유 치환자를 채웁니다. */
export function expandCommandValue(
  template: string,
  command: CustomCommand,
  shownItems: string[],
  overflow: number,
  counterValue: number
): string {
  const value =
    command.type === 'list'
      ? shownItems.join(', ') + (overflow > 0 ? ` 외 ${overflow}명` : '')
      : String(counterValue);

  return template
    .replaceAll('{value}', value)
    .replaceAll('$값', value)
    .replaceAll('{n}', String(command.items.length))
    .replaceAll('$개수', String(command.items.length));
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 ${minutes % 60}분`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}
