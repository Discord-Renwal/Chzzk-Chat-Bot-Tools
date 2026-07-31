import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';

export interface Chatter {
  channelId: string;
  nickname: string;
  /** 마지막으로 채팅한 시각 */
  at: number;
}

/**
 * 최근에 채팅한 사람의 닉네임 → 채널 ID 색인.
 *
 * 관리자 명령이 `!지급 홍길동 100` 처럼 **닉네임**으로 대상을 지정하는데,
 * 치지직 API 에는 닉네임으로 사용자를 찾는 엔드포인트가 없습니다.
 * 그래서 채팅 이벤트를 지나갈 때마다 기억해 두는 방식으로 해결합니다.
 *
 * 한계가 분명합니다: **채팅을 친 적 없는 사람은 찾을 수 없습니다.**
 * 명령 응답에서 그 점을 사용자에게 알려줘야 합니다.
 */
export class ChatterIndex {
  private readonly byNickname = new Map<string, Chatter>();

  constructor(private readonly capacity = 2000) {}

  remember(event: ChatEvent): void {
    const nickname = event.profile?.nickname?.trim();
    if (!nickname) return;

    const key = nickname.toLowerCase();
    // Map 은 삽입 순서를 지키므로, 지웠다 다시 넣으면 최근 항목이 뒤로 갑니다.
    this.byNickname.delete(key);
    this.byNickname.set(key, {
      channelId: event.senderChannelId,
      nickname,
      at: event.messageTime || Date.now(),
    });

    if (this.byNickname.size > this.capacity) {
      // 가장 오래된 것부터 버립니다.
      const oldest = this.byNickname.keys().next();
      if (!oldest.done) this.byNickname.delete(oldest.value);
    }
  }

  /**
   * 닉네임으로 찾습니다. 기본은 **정확히 일치**할 때만입니다.
   *
   * 앞부분 일치는 위험합니다. 이 색인은 최근 채팅한 사람만 담고 있어서,
   * 정확히 그 닉네임인 사람이 색인에서 밀려났을 때만 앞부분 일치가 발동합니다.
   * 즉 "달" 이 밀려난 상태에서 `!밴 달` 을 치면 "달빛여우" 가 밴됩니다.
   * 그래서 제재처럼 되돌리기 어려운 동작에는 정확 일치만 허용합니다.
   */
  find(nickname: string, options: { allowPrefix?: boolean } = {}): Chatter | null {
    const key = nickname.trim().toLowerCase();
    if (!key) return null;

    const exact = this.byNickname.get(key);
    if (exact) return exact;
    if (!options.allowPrefix) return null;

    const partial = [...this.byNickname.values()].filter((c) =>
      c.nickname.toLowerCase().startsWith(key)
    );
    // 후보가 여럿이면 엉뚱한 사람을 고를 수 있으므로 포기합니다.
    return partial.length === 1 ? partial[0]! : null;
  }

  get size(): number {
    return this.byNickname.size;
  }
}
