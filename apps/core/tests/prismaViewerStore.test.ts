import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerRecord } from '@chzzk-bot/contracts';
import type { ViewerRepository } from '@chzzk-bot/database';
import { PrismaViewerStore } from '../src/adapters/prismaViewerStore.js';

/**
 * 시청자 저장소 어댑터.
 *
 * 채팅 1건마다 지나가는 유일한 경로라, 여기서 실수하면 방송 내내 포인트가
 * 어긋납니다. 특히 확인하고 싶은 것은 **모아 쓰기(batching)** 입니다 —
 * 바뀐 사람만 내려쓰는지, 저장이 실패했을 때 그 변경분을 잃지 않는지.
 */

function makeRepository(initial: ViewerRecord[] = []) {
  const saved: ViewerRecord[][] = [];
  const repository = {
    all: vi.fn(async () => initial),
    flushMany: vi.fn(async (_tenantId: string, viewers: ViewerRecord[]) => {
      saved.push(viewers);
    }),
  } as unknown as ViewerRepository;

  return { repository, saved };
}

function viewer(overrides: Partial<ViewerRecord> = {}): ViewerRecord {
  return {
    channelId: 'ch_a',
    nickname: '기존시청자',
    points: 100,
    chatCount: 5,
    firstSeenAt: Date.now() - 86_400_000,
    lastSeenAt: Date.now() - 3600_000,
    attendanceStreak: 2,
    lastAttendanceDate: '',
    ...overrides,
  };
}

describe('PrismaViewerStore', () => {
  let harness: ReturnType<typeof makeRepository>;

  beforeEach(() => {
    harness = makeRepository([viewer()]);
  });

  it('열 때 기존 시청자를 메모리로 올린다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    expect(store.userCount).toBe(1);
    expect(store.get('ch_a')?.points).toBe(100);
    expect(store.isFirstEver('ch_a')).toBe(false);
    expect(store.isFirstEver('ch_new')).toBe(true);
  });

  it('채팅을 기록하면 포인트가 쌓인다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    expect(store.recordChat('ch_a', '기존시청자', 10)).toBe(110);
    expect(store.get('ch_a')?.chatCount).toBe(6);
  });

  it('처음 보는 사람은 새로 만든다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    expect(store.recordChat('ch_new', '새사람', 10)).toBe(10);
    expect(store.userCount).toBe(2);
  });

  it('포인트는 0 아래로 내려가지 않는다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    expect(store.addPoints('ch_a', '', -500)).toBe(0);
  });

  it('포인트가 부족하면 쓰지 못한다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    expect(store.spendPoints('ch_a', 200)).toBe(false);
    expect(store.get('ch_a')?.points).toBe(100);

    expect(store.spendPoints('ch_a', 60)).toBe(true);
    expect(store.get('ch_a')?.points).toBe(40);
  });

  it('출석은 하루에 한 번만 인정한다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    const first = store.checkAttendance('ch_a', '기존시청자', 100, 20, 200);
    expect(first.checked).toBe(true);
    expect(first.reward).toBe(100);

    const second = store.checkAttendance('ch_a', '기존시청자', 100, 20, 200);
    expect(second.checked).toBe(false);
    expect(second.reward).toBe(0);
  });

  it('바뀐 사람만 저장한다', async () => {
    // 두 명을 올려 두고 한 명만 건드립니다. 전부 내려쓰면 시청자가 늘어날수록
    // 저장 비용이 선형으로 커지고, 결국 채팅 처리가 밀립니다.
    const two = makeRepository([viewer(), viewer({ channelId: 'ch_b' })]);
    const store = await PrismaViewerStore.open(two.repository, 't1');

    store.recordChat('ch_a', '기존시청자', 10);
    await store.flush();

    expect(two.saved).toHaveLength(1);
    expect(two.saved[0]).toHaveLength(1);
    expect(two.saved[0]?.[0]?.channelId).toBe('ch_a');
  });

  it('바뀐 게 없으면 저장하지 않는다', async () => {
    const store = await PrismaViewerStore.open(harness.repository, 't1');

    await store.flush();
    expect(harness.saved).toHaveLength(0);
  });

  it('저장에 실패하면 다음 flush 에서 다시 시도한다', async () => {
    const failing = makeRepository([viewer()]);
    let attempt = 0;

    // 첫 저장만 실패시킵니다. 실패한 변경분을 잃지 않고 다시 쓰는지 보는 게 목적입니다.
    vi.mocked(failing.repository.flushMany).mockImplementation(
      (_tenantId: string, viewers: ViewerRecord[]): Promise<void> => {
        attempt += 1;
        if (attempt === 1) return Promise.reject(new Error('DB 연결 실패'));
        failing.saved.push(viewers);
        return Promise.resolve();
      }
    );

    const store = await PrismaViewerStore.open(failing.repository, 't1');
    store.recordChat('ch_a', '기존시청자', 10);

    await store.flush();
    expect(failing.saved).toHaveLength(0);

    // 변경분이 큐에 남아 있어야 합니다. 잃어버리면 그 포인트는 영영 사라집니다.
    await store.flush();
    expect(failing.saved).toHaveLength(1);
    expect(failing.saved[0]?.[0]?.points).toBe(110);
  });

  it('순위는 포인트 기준으로 매긴다', async () => {
    const many = makeRepository([
      viewer({ channelId: 'ch_a', points: 100 }),
      viewer({ channelId: 'ch_b', points: 300 }),
      viewer({ channelId: 'ch_c', points: 200 }),
    ]);
    const store = await PrismaViewerStore.open(many.repository, 't1');

    expect(store.rankOf('ch_b')).toBe(1);
    expect(store.rankOf('ch_c')).toBe(2);
    expect(store.rankOf('ch_a')).toBe(3);
    expect(store.rankOf('ch_none')).toBeNull();

    expect(store.topByPoints(2).map((v) => v.channelId)).toEqual(['ch_b', 'ch_c']);
  });

  it('포인트 초기화는 모두를 저장 대상으로 만든다', async () => {
    const many = makeRepository([
      viewer({ channelId: 'ch_a', points: 100 }),
      viewer({ channelId: 'ch_b', points: 300 }),
    ]);
    const store = await PrismaViewerStore.open(many.repository, 't1');

    store.resetAllPoints();
    await store.flush();

    expect(many.saved[0]).toHaveLength(2);
    expect(many.saved[0]?.every((v) => v.points === 0)).toBe(true);
  });
});
