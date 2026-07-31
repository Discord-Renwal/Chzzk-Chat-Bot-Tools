import type { PlanLimits } from '@chzzk-bot/contracts';
import type { Repositories } from '@chzzk-bot/database';

export type LimitKey = 'commands' | 'autoResponses' | 'timers' | 'bannedWords';

const LIMIT_FIELD: Record<LimitKey, keyof PlanLimits> = {
  commands: 'maxCommands',
  autoResponses: 'maxAutoResponses',
  timers: 'maxTimers',
  bannedWords: 'maxBannedWords',
};

const LIMIT_LABEL: Record<LimitKey, string> = {
  commands: '명령어',
  autoResponses: '자동응답',
  timers: '주기 메시지',
  bannedWords: '금칙어',
};

export interface EntitlementCheck {
  allowed: boolean;
  /** 막혔을 때 사용자에게 그대로 보여줄 문장 */
  message: string | null;
  current: number;
  limit: number | null;
}

/**
 * 플랜 한도 검사.
 *
 * 검사를 **쓰기 직전에** 하는 게 중요합니다. 화면에서만 막으면 API 를 직접 부르는
 * 사람에게는 없는 규칙이 되고, 그렇게 넘어간 데이터는 다운그레이드 때 처리할
 * 방법이 없습니다.
 *
 * 넘겼다고 기존 것을 지우지는 않습니다. 플랜을 내렸을 때 이미 만들어 둔 명령어가
 * 사라지면 사용자는 다시 올려도 복구할 수 없습니다. 대신 **추가만** 막습니다.
 */
export class EntitlementService {
  constructor(private readonly repositories: Repositories) {}

  /** 이 채널이 지금 서비스를 쓸 수 있는지 */
  async isEntitled(tenantId: string): Promise<boolean> {
    const { entitled } = await this.repositories.subscriptions.entitlement(tenantId);
    return entitled;
  }

  async limits(tenantId: string): Promise<PlanLimits | null> {
    const { limits } = await this.repositories.subscriptions.entitlement(tenantId);
    return limits;
  }

  /** 항목을 하나 더 만들어도 되는지 */
  async canAdd(tenantId: string, key: LimitKey): Promise<EntitlementCheck> {
    const [{ limits }, counts] = await Promise.all([
      this.repositories.subscriptions.entitlement(tenantId),
      this.repositories.botConfig.counts(tenantId),
    ]);

    if (!limits) {
      return {
        allowed: false,
        message: '구독 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        current: 0,
        limit: null,
      };
    }

    const limit = limits[LIMIT_FIELD[key]] as number | null;
    const current = counts[key];

    // null 은 무제한입니다. 0 과 헷갈리지 않도록 명시적으로 비교합니다.
    if (limit === null) return { allowed: true, message: null, current, limit: null };

    if (current >= limit) {
      return {
        allowed: false,
        message: `현재 요금제에서는 ${LIMIT_LABEL[key]}를 ${limit}개까지 만들 수 있습니다. 요금제를 올리면 더 쓸 수 있어요.`,
        current,
        limit,
      };
    }

    return { allowed: true, message: null, current, limit };
  }

  /** 기능 단위 사용 가능 여부 (미니게임·신청곡·공개 API) */
  async canUse(
    tenantId: string,
    feature: 'games' | 'songRequests' | 'publicApi'
  ): Promise<EntitlementCheck> {
    const limits = await this.limits(tenantId);
    if (!limits) {
      return {
        allowed: false,
        message: '구독 정보를 확인할 수 없습니다.',
        current: 0,
        limit: null,
      };
    }

    const enabled =
      feature === 'games'
        ? limits.gamesEnabled
        : feature === 'songRequests'
          ? limits.songRequestsEnabled
          : limits.publicApiEnabled;

    const label =
      feature === 'games' ? '미니게임' : feature === 'songRequests' ? '신청곡' : '명령 실행 API';

    return {
      allowed: enabled,
      message: enabled ? null : `${label}은(는) 스타터 요금제부터 사용할 수 있습니다.`,
      current: 0,
      limit: null,
    };
  }
}
