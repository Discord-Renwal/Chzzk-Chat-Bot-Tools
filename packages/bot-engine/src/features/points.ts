import type { ViewerStore } from '../ports.js';
import type { PointSettings } from '@chzzk-bot/contracts';
import { CooldownTracker } from './cooldown.js';

/**
 * 포인트 적립 규칙.
 *
 * 치지직 API 에는 시청자 목록 조회가 없어서 "시청 시간당 적립" 은 만들 수 없습니다.
 * 채팅을 친 사람만 관측되므로 적립 기준도 채팅·후원·구독으로 한정했습니다.
 * 대신 채팅 도배로 포인트를 긁어모으지 못하도록 사람별 쿨다운을 둡니다.
 */
export class PointEngine {
  private readonly earnCooldown = new CooldownTracker();

  constructor(private readonly users: ViewerStore) {}

  /**
   * 채팅 1회를 기록합니다. 쿨다운 중이면 채팅 수만 세고 포인트는 주지 않습니다.
   * @returns 이번에 적립된 포인트 (0 이면 미적립)
   */
  onChat(channelId: string, nickname: string, settings: PointSettings): number {
    if (!settings.enabled) {
      this.users.recordChat(channelId, nickname, 0);
      return 0;
    }

    const canEarn = this.earnCooldown.tryUse(channelId, settings.chatCooldownSec);
    const earned = canEarn ? settings.perChat : 0;
    this.users.recordChat(channelId, nickname, earned);
    return earned;
  }

  /**
   * 후원 적립. `payAmount` 는 문서상 문자열이라 숫자로 바꿔 씁니다.
   * @returns 적립된 포인트
   */
  onDonation(
    channelId: string,
    nickname: string,
    payAmountRaw: string,
    settings: PointSettings
  ): number {
    if (!settings.enabled || settings.perThousandWon === 0) return 0;

    const amount = Number(String(payAmountRaw).replace(/[^\d]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const earned = Math.floor((amount / 1000) * settings.perThousandWon);
    if (earned <= 0) return 0;

    this.users.addPoints(channelId, nickname, earned);
    return earned;
  }

  /** 구독 적립 */
  onSubscription(
    channelId: string,
    nickname: string,
    months: number,
    settings: PointSettings
  ): number {
    if (!settings.enabled || settings.perSubscriptionMonth === 0) return 0;

    const earned = Math.max(1, months) * settings.perSubscriptionMonth;
    this.users.addPoints(channelId, nickname, earned);
    return earned;
  }
}

/** 1,234 형태로 */
export function formatPoints(value: number): string {
  return value.toLocaleString('ko-KR');
}
