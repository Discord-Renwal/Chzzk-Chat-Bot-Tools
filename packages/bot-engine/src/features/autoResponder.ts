import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { BotConfig } from '@chzzk-bot/contracts';
import { CooldownTracker } from './cooldown.js';
import { matches } from './matcher.js';

/**
 * 키워드에 반응해 자동으로 답하는 기능.
 *
 * 쿨다운은 사용자별이 아니라 규칙별(채널 공통)입니다. 여러 사람이 동시에 "안녕"을
 * 치면 봇이 그만큼 도배하게 되는데, 그걸 막는 게 목적이기 때문입니다.
 */
export class AutoResponder {
  private readonly cooldowns = new CooldownTracker();

  constructor(private readonly random: () => number = Math.random) {}

  /** 걸리는 규칙이 있으면 응답 문구를, 없으면 null 을 돌려줍니다. */
  respond(event: ChatEvent, config: BotConfig): string | null {
    const content = event.content?.trim() ?? '';
    if (!content) return null;

    for (const rule of config.autoResponses) {
      if (!rule.enabled) continue;
      if (!matches(content, rule.pattern, rule.mode, rule.caseSensitive)) continue;

      // 확률 판정을 쿨다운보다 먼저 하면, 떨어졌을 때 쿨다운이 소모되지 않아
      // 다음 메시지에서 바로 다시 굴릴 수 있습니다.
      if (rule.chancePercent < 100 && this.random() * 100 >= rule.chancePercent) continue;
      if (!this.cooldowns.tryUse(rule.id, rule.cooldownSec)) continue;

      return rule.response.replaceAll('{user}', event.profile?.nickname ?? '');
    }

    return null;
  }
}
