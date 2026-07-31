import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { BannedWord, BotConfig } from '@chzzk-bot/contracts';
import { matches } from './matcher.js';
import { normalizeRole } from './permissions.js';

export interface ModerationVerdict {
  word: BannedWord;
  /** 메시지를 숨길지 */
  blind: boolean;
  /** 임시 제한을 걸지 */
  tempBan: boolean;
  /** 채팅으로 내보낼 경고 문구 (없으면 null) */
  warn: string | null;
}

/**
 * 금칙어 검사.
 *
 * 실제 제재 실행은 하지 않고 판정만 돌려줍니다. API 호출은 런타임이 맡아,
 * 이 클래스는 네트워크 없이 테스트할 수 있습니다.
 */
export class Moderator {
  /** 걸리면 판정을, 아니면 null 을 돌려줍니다. */
  inspect(event: ChatEvent, config: BotConfig): ModerationVerdict | null {
    const settings = config.moderation;
    if (!settings.enabled) return null;

    // 스트리머와 매니저는 기본적으로 검사에서 제외됩니다.
    if (settings.exemptRoles.includes(normalizeRole(event.userRoleCode))) return null;

    const content = event.content ?? '';
    if (!content.trim()) return null;

    for (const word of settings.words) {
      if (!word.enabled) continue;
      if (!matches(content, word.pattern, word.mode, word.caseSensitive)) continue;

      // 설정에서 임시 제한을 꺼두면 숨기기까지만 수행합니다.
      const tempBan = word.action === 'blindAndTempBan' && settings.allowTempBan;
      const wantsWarn = word.action === 'blindAndWarn' || word.action === 'blindAndTempBan';

      const nickname = event.profile?.nickname ?? '';
      const warn = wantsWarn
        ? (word.warnMessage || '{user}님, 사용할 수 없는 표현이 포함되어 있습니다.').replaceAll(
            '{user}',
            nickname
          )
        : null;

      return { word, blind: true, tempBan, warn };
    }

    return null;
  }
}
