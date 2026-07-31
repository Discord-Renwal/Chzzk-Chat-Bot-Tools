import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { SpamSettings } from '@chzzk-bot/contracts';
import { normalizeRole } from './permissions.js';

export type SpamReason = 'repeatedChars' | 'length' | 'duplicate' | 'emojis' | 'link';

export interface SpamVerdict {
  reason: SpamReason;
  /** 사람이 읽을 설명 */
  label: string;
  /** 이 사람의 누적 위반 횟수 */
  violations: number;
  /** 임시 제한까지 갈지 */
  escalateToTempBan: boolean;
}

const REASON_LABELS: Record<SpamReason, string> = {
  repeatedChars: '같은 문자 반복',
  length: '너무 긴 메시지',
  duplicate: '같은 메시지 반복',
  emojis: '이모티콘 과다',
  link: '링크',
};

interface Violation {
  count: number;
  lastAt: number;
}

/**
 * 한국 채팅 환경에 맞춘 스팸 필터.
 *
 * 영어권 봇이 쓰는 "대문자 비율" 은 한글에 무의미해서 넣지 않았고,
 * 대신 자음 연타(ㅋㅋㅋㅋ…)·같은 말 반복·링크를 봅니다.
 *
 * 위반이 쌓이면 조치가 세지고, 일정 시간이 지나면 기록이 사라집니다.
 * 한 번 실수한 사람이 영원히 불이익을 받지 않게 하려는 것입니다.
 */
export class SpamFilter {
  private readonly violations = new Map<string, Violation>();
  /** channelId → 마지막 메시지 (중복 검사용) */
  private readonly lastMessage = new Map<string, { text: string; at: number }>();

  inspect(event: ChatEvent, settings: SpamSettings): SpamVerdict | null {
    if (!settings.enabled) return null;
    if (settings.exemptRoles.includes(normalizeRole(event.userRoleCode))) return null;

    const content = event.content ?? '';
    if (!content.trim()) return null;

    const reason = this.detect(event, content, settings);
    if (!reason) {
      // 깨끗한 메시지는 중복 검사를 위해 기록만 남깁니다.
      this.lastMessage.set(event.senderChannelId, { text: content, at: Date.now() });
      return null;
    }

    const violations = this.recordViolation(event.senderChannelId, settings);
    return {
      reason,
      label: REASON_LABELS[reason],
      violations,
      escalateToTempBan: settings.escalate && violations >= settings.tempBanAfterViolations,
    };
  }

  private detect(event: ChatEvent, content: string, settings: SpamSettings): SpamReason | null {
    if (settings.maxLength > 0 && content.length > settings.maxLength) return 'length';

    if (settings.maxRepeatedChars > 0 && hasRepeatedRun(content, settings.maxRepeatedChars)) {
      return 'repeatedChars';
    }

    if (settings.maxEmojis > 0) {
      const emojiCount = Object.keys(event.emojis ?? {}).length;
      if (emojiCount > settings.maxEmojis) return 'emojis';
    }

    if (settings.blockLinks && containsBlockedLink(content, settings.allowedDomains)) {
      return 'link';
    }

    if (settings.duplicateWindowSec > 0) {
      const previous = this.lastMessage.get(event.senderChannelId);
      const withinWindow =
        previous && Date.now() - previous.at <= settings.duplicateWindowSec * 1000;
      if (withinWindow && previous.text.trim() === content.trim()) return 'duplicate';
    }

    return null;
  }

  private recordViolation(channelId: string, settings: SpamSettings): number {
    const now = Date.now();
    const decayMs = settings.violationDecayMinutes * 60_000;
    const existing = this.violations.get(channelId);

    // 마지막 위반이 오래됐으면 처음부터 다시 셉니다.
    const count = existing && now - existing.lastAt <= decayMs ? existing.count + 1 : 1;
    this.violations.set(channelId, { count, lastAt: now });

    // 기록이 무한정 쌓이지 않도록 가끔 정리합니다.
    if (this.violations.size > 5000) this.sweep(now, decayMs);
    return count;
  }

  private sweep(now: number, decayMs: number): void {
    for (const [id, violation] of this.violations) {
      if (now - violation.lastAt > decayMs) this.violations.delete(id);
    }
  }

  /** 특정 사용자의 위반 기록을 지웁니다. */
  forgive(channelId: string): void {
    this.violations.delete(channelId);
  }
}

/**
 * 같은 문자가 limit 개를 넘겨 연속으로 나오는지.
 * `ㅋㅋㅋㅋㅋㅋㅋ`, `!!!!!!!!` 같은 도배를 잡습니다.
 */
export function hasRepeatedRun(text: string, limit: number): boolean {
  if (limit <= 0) return false;

  let run = 1;
  const chars = [...text];
  for (let i = 1; i < chars.length; i++) {
    if (chars[i] === chars[i - 1]) {
      run += 1;
      if (run > limit) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

/** 허용 목록에 없는 링크가 있는지 */
export function containsBlockedLink(text: string, allowedDomains: string[]): boolean {
  // http 없이 쓰는 `youtube.com/watch` 형태도 잡습니다.
  const pattern = /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/\S*)?/gi;
  const allowed = allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean);

  for (const match of text.matchAll(pattern)) {
    const host = match[1]?.toLowerCase();
    if (!host) continue;
    // 최상위 도메인처럼 보이지 않으면 링크로 치지 않습니다 (예: "3.14")
    if (!/[a-z]{2,}$/.test(host)) continue;

    const isAllowed = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!isAllowed) return true;
  }
  return false;
}
