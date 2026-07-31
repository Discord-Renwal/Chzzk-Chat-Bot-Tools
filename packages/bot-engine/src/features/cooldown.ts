/**
 * 키별 쿨다운 추적기.
 *
 * 오래된 항목을 주기적으로 걷어내지 않으면 시청자 수만큼 Map 이 무한히 자랍니다.
 * 조회할 때마다 만료된 항목을 정리하고, 항목 수가 많아지면 한 번에 쓸어냅니다.
 */
export class CooldownTracker {
  private readonly readyAt = new Map<string, number>();

  constructor(private readonly maxEntries = 5000) {}

  /** 지금 사용할 수 있으면 true 를 돌려주고 쿨다운을 다시 시작합니다. */
  tryUse(key: string, cooldownSec: number, now = Date.now()): boolean {
    if (cooldownSec <= 0) return true;

    const readyAt = this.readyAt.get(key) ?? 0;
    if (now < readyAt) return false;

    this.readyAt.set(key, now + cooldownSec * 1000);
    if (this.readyAt.size > this.maxEntries) this.sweep(now);
    return true;
  }

  /** 남은 시간(초). 사용 가능하면 0 */
  remaining(key: string, now = Date.now()): number {
    const readyAt = this.readyAt.get(key) ?? 0;
    return readyAt > now ? Math.ceil((readyAt - now) / 1000) : 0;
  }

  private sweep(now: number): void {
    for (const [key, readyAt] of this.readyAt) {
      if (readyAt <= now) this.readyAt.delete(key);
    }
  }

  clear(): void {
    this.readyAt.clear();
  }
}
