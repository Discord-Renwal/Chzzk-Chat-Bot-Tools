import type { GameSettings, PointSettings } from '@chzzk-bot/contracts';
import type { ViewerStore } from '../ports.js';
import { CooldownTracker } from './cooldown.js';
import { formatPoints } from './points.js';

const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '7️⃣'] as const;

/**
 * 게임 명령 이름.
 *
 * 런타임의 분기와 대시보드의 이름 충돌 검사가 **같은 목록**을 봐야 합니다.
 * 따로 두면 여기만 늘렸을 때 대시보드가 겹치는 이름을 허용해,
 * 저장은 되는데 실행되지 않는 명령이 생깁니다.
 */
export const GAME_COMMAND_NAMES = {
  gamble: ['도박', 'gamble'],
  dice: ['주사위', 'dice'],
  slots: ['슬롯', 'slot', 'slots'],
} as const;

/** 게임 명령 이름이면 true */
export function isGameCommandName(name: string): boolean {
  const key = name.toLowerCase();
  return Object.values(GAME_COMMAND_NAMES).some((names) =>
    names.some((n) => n.toLowerCase() === key)
  );
}

export interface GameResult {
  /** 채팅에 내보낼 문구 */
  message: string;
  /** 순증감 (+이면 이득) */
  delta: number;
}

/**
 * 포인트를 거는 미니게임.
 *
 * 주의한 점:
 * - 베팅액을 **먼저 차감**하고 결과를 계산합니다. 중간에 실패해도 공짜로 굴릴 수 없습니다.
 * - 승률과 배율은 설정으로 노출하되 기대값이 1을 넘지 않도록 기본값을 잡았습니다.
 *   포인트가 무한히 불어나면 랭킹도 상점도 의미가 없어집니다.
 */
export class GameEngine {
  private readonly cooldowns = new CooldownTracker();

  constructor(
    private readonly users: ViewerStore,
    private readonly random: () => number = Math.random
  ) {}

  /**
   * 베팅 전 공통 검사 — 활성화, 쿨다운, 금액 범위, 잔액.
   * @returns 문제가 있으면 안내 문구, 통과하면 확정된 베팅액
   */
  private validate(
    channelId: string,
    betRaw: string | undefined,
    settings: GameSettings,
    points: PointSettings
  ): { error: string } | { bet: number } {
    // 게임 전체가 꺼진 경우는 호출자가 먼저 걸러야 합니다.
    // 여기서 "빈 오류" 같은 애매한 값을 돌려주면 호출자가 처리 여부를 헷갈립니다.
    if (!points.enabled) return { error: '포인트 기능이 꺼져 있어 게임을 할 수 없습니다.' };

    const held = this.users.get(channelId)?.points ?? 0;
    const unit = points.unitName;

    // "올인" 은 최대 베팅으로 상한을 둡니다. 전 재산을 한 번에 날리면 이탈합니다.
    const bet =
      betRaw === '올인' || betRaw === 'all'
        ? Math.min(held, settings.maxBet)
        : Math.floor(Number(betRaw));

    if (!Number.isFinite(bet) || bet <= 0) {
      return { error: `사용법: 금액을 입력하세요. (${settings.minBet}~${settings.maxBet}${unit})` };
    }
    if (bet < settings.minBet)
      return { error: `최소 ${formatPoints(settings.minBet)}${unit}부터 가능합니다.` };
    if (bet > settings.maxBet)
      return { error: `최대 ${formatPoints(settings.maxBet)}${unit}까지 가능합니다.` };
    if (held < bet) return { error: `${unit}가 부족합니다. (보유 ${formatPoints(held)}${unit})` };

    const remaining = this.cooldowns.remaining(channelId);
    if (remaining > 0) return { error: `${remaining}초 후에 다시 시도해 주세요.` };

    return { bet };
  }

  private start(channelId: string, bet: number, settings: GameSettings): boolean {
    this.cooldowns.tryUse(channelId, settings.cooldownSec);
    return this.users.spendPoints(channelId, bet);
  }

  /** !도박 — 확률에 따라 베팅액만큼 벌거나 잃습니다. */
  gamble(
    channelId: string,
    nickname: string,
    betRaw: string | undefined,
    settings: GameSettings,
    points: PointSettings
  ): GameResult | null {
    if (!settings.gambleEnabled) return null;

    const checked = this.validate(channelId, betRaw, settings, points);
    if ('error' in checked) return { message: checked.error, delta: 0 };
    if (!this.start(channelId, checked.bet, settings)) return null;

    const unit = points.unitName;
    const won = this.random() * 100 < settings.gambleWinPercent;

    if (won) {
      const total = this.users.addPoints(channelId, nickname, checked.bet * 2);
      return {
        message: `🎲 ${nickname}님 승리! +${formatPoints(checked.bet)}${unit} (보유 ${formatPoints(total)})`,
        delta: checked.bet,
      };
    }

    const total = this.users.get(channelId)?.points ?? 0;
    return {
      message: `💥 ${nickname}님 패배… -${formatPoints(checked.bet)}${unit} (보유 ${formatPoints(total)})`,
      delta: -checked.bet,
    };
  }

  /** !주사위 — 봇과 굴려서 높은 쪽이 이깁니다. */
  dice(
    channelId: string,
    nickname: string,
    betRaw: string | undefined,
    settings: GameSettings,
    points: PointSettings
  ): GameResult | null {
    if (!settings.diceEnabled) return null;

    const checked = this.validate(channelId, betRaw, settings, points);
    if ('error' in checked) return { message: checked.error, delta: 0 };
    if (!this.start(channelId, checked.bet, settings)) return null;

    const unit = points.unitName;
    const mine = 1 + Math.floor(this.random() * 6);
    const bot = 1 + Math.floor(this.random() * 6);
    const roll = `🎲 ${nickname} ${mine} vs 봇 ${bot}`;

    if (mine > bot) {
      const total = this.users.addPoints(channelId, nickname, checked.bet * 2);
      return {
        message: `${roll} — 승리! +${formatPoints(checked.bet)}${unit} (보유 ${formatPoints(total)})`,
        delta: checked.bet,
      };
    }
    if (mine === bot) {
      // 무승부는 베팅액을 그대로 돌려줍니다.
      const total = this.users.addPoints(channelId, nickname, checked.bet);
      return { message: `${roll} — 무승부, 반환 (보유 ${formatPoints(total)}${unit})`, delta: 0 };
    }

    const total = this.users.get(channelId)?.points ?? 0;
    return {
      message: `${roll} — 패배… -${formatPoints(checked.bet)}${unit} (보유 ${formatPoints(total)})`,
      delta: -checked.bet,
    };
  }

  /** !슬롯 — 3개 일치 대박, 2개 일치 소액. */
  slots(
    channelId: string,
    nickname: string,
    betRaw: string | undefined,
    settings: GameSettings,
    points: PointSettings
  ): GameResult | null {
    if (!settings.slotsEnabled) return null;

    const checked = this.validate(channelId, betRaw, settings, points);
    if ('error' in checked) return { message: checked.error, delta: 0 };
    if (!this.start(channelId, checked.bet, settings)) return null;

    const unit = points.unitName;
    const reels = [0, 1, 2].map(
      () => SLOT_SYMBOLS[Math.floor(this.random() * SLOT_SYMBOLS.length)]!
    );
    const view = reels.join(' ');

    const allSame = reels[0] === reels[1] && reels[1] === reels[2];
    const pair = !allSame && new Set(reels).size === 2;

    if (allSame) {
      const payout = checked.bet * settings.slotsJackpotMultiplier;
      const total = this.users.addPoints(channelId, nickname, payout);
      return {
        message: `[ ${view} ] 잭팟!! ${nickname}님 +${formatPoints(payout - checked.bet)}${unit} (보유 ${formatPoints(total)})`,
        delta: payout - checked.bet,
      };
    }
    if (pair) {
      const payout = checked.bet * settings.slotsPairMultiplier;
      const total = this.users.addPoints(channelId, nickname, payout);
      const net = payout - checked.bet;
      return {
        message: `[ ${view} ] 두 개 일치! ${nickname}님 ${net >= 0 ? '+' : ''}${formatPoints(net)}${unit} (보유 ${formatPoints(total)})`,
        delta: net,
      };
    }

    const total = this.users.get(channelId)?.points ?? 0;
    return {
      message: `[ ${view} ] 꽝… ${nickname}님 -${formatPoints(checked.bet)}${unit} (보유 ${formatPoints(total)})`,
      delta: -checked.bet,
    };
  }
}
