import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerScheduler } from '../src/features/timers.js';
import { timerMessage, type TimerMessage } from '@chzzk-bot/contracts';

function timer(overrides: Partial<TimerMessage> = {}): TimerMessage {
  return timerMessage.parse({
    id: 'tm_1',
    label: '테스트',
    message: '안내 메시지',
    intervalMinutes: 15,
    minChatsSinceLast: 10,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** tick(10초) 을 n분어치 진행시킵니다. */
async function advanceMinutes(minutes: number) {
  await vi.advanceTimersByTimeAsync(minutes * 60_000);
}

describe('TimerScheduler', () => {
  it('시작 시점에 있던 타이머도 조건을 채우면 발사된다', async () => {
    // 회귀 테스트: start() 가 채팅 카운터를 초기화하지 않아, noteChat() 이
    // 그 타이머를 세지 못했다. 기본값(minChatsSinceLast=10) 때문에 조건이
    // 영원히 충족되지 않아 주기 메시지가 아예 동작하지 않았다.
    const sent: string[] = [];
    const timers = [timer({ intervalMinutes: 1, minChatsSinceLast: 3 })];

    const scheduler = new TimerScheduler(
      () => timers,
      async (message) => {
        sent.push(message);
      }
    );
    scheduler.start();

    for (let i = 0; i < 3; i++) scheduler.noteChat();
    await advanceMinutes(2);

    expect(sent).toEqual(['안내 메시지']);
    scheduler.stop();
  });

  it('채팅이 부족하면 시간이 지나도 보내지 않는다', async () => {
    const sent: string[] = [];
    const timers = [timer({ intervalMinutes: 1, minChatsSinceLast: 5 })];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();

    scheduler.noteChat(); // 5회에 못 미침
    await advanceMinutes(5);

    expect(sent).toEqual([]);
    scheduler.stop();
  });

  it('채팅 조건이 0이면 시간만으로 발사된다', async () => {
    const sent: string[] = [];
    const timers = [timer({ intervalMinutes: 1, minChatsSinceLast: 0 })];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();

    // 간격이 1분이므로 70초 뒤에 한 번 나갑니다.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(sent).toHaveLength(1);

    // 다시 1분이 지나면 또 나갑니다.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(sent).toHaveLength(2);

    scheduler.stop();
  });

  it('발사 후에는 채팅 카운터가 초기화되어 연달아 나가지 않는다', async () => {
    const sent: string[] = [];
    const timers = [timer({ intervalMinutes: 1, minChatsSinceLast: 2 })];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();

    scheduler.noteChat();
    scheduler.noteChat();
    await advanceMinutes(2);
    expect(sent).toHaveLength(1);

    // 채팅 없이 시간만 흘러도 두 번째는 안 나갑니다.
    await advanceMinutes(5);
    expect(sent).toHaveLength(1);

    scheduler.stop();
  });

  it('꺼진 타이머는 발사하지 않는다', async () => {
    const sent: string[] = [];
    const timers = [timer({ intervalMinutes: 1, minChatsSinceLast: 0, enabled: false })];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();
    await advanceMinutes(5);

    expect(sent).toEqual([]);
    scheduler.stop();
  });

  it('여러 타이머가 동시에 만기여도 한 번에 하나만 나간다', async () => {
    const sent: string[] = [];
    const timers = [
      timer({ id: 'a', message: 'A', intervalMinutes: 1, minChatsSinceLast: 0 }),
      timer({ id: 'b', message: 'B', intervalMinutes: 1, minChatsSinceLast: 0 }),
    ];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();

    // 전역 최소 간격(30초)이 있어 한 tick 에 하나만 나갑니다.
    await vi.advanceTimersByTimeAsync(70_000);
    expect(sent).toEqual(['A']);

    await vi.advanceTimersByTimeAsync(40_000);
    expect(sent).toEqual(['A', 'B']);

    scheduler.stop();
  });

  it('나중에 추가된 타이머도 동작한다', async () => {
    const sent: string[] = [];
    const timers: TimerMessage[] = [];

    const scheduler = new TimerScheduler(
      () => timers,
      async (m) => void sent.push(m)
    );
    scheduler.start();

    timers.push(timer({ intervalMinutes: 1, minChatsSinceLast: 2 }));
    scheduler.sync();

    scheduler.noteChat();
    scheduler.noteChat();
    await advanceMinutes(2);

    expect(sent).toEqual(['안내 메시지']);
    scheduler.stop();
  });

  it('삭제된 타이머의 상태는 정리된다', () => {
    const timers = [timer({ id: 'gone' })];
    const scheduler = new TimerScheduler(
      () => timers,
      async () => {}
    );
    scheduler.start();

    expect(scheduler.nextInSeconds(timers[0]!)).not.toBeNull();

    timers.length = 0;
    scheduler.sync();

    // 상태가 남아 있으면 메모리가 새고, 같은 id 재사용 시 오동작합니다.
    expect(scheduler.nextInSeconds(timer({ id: 'gone' }))).toBeNull();
    scheduler.stop();
  });
});
