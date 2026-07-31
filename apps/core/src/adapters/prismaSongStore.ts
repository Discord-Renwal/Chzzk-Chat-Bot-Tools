import { randomUUID } from 'node:crypto';
import type { SongRequest } from '@chzzk-bot/contracts';
import type { SongStore } from '@chzzk-bot/bot-engine';
import type { BotRuntimeRepository } from '@chzzk-bot/database';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/** 완료/스킵된 곡은 이 개수까지만 남기고 오래된 것부터 버립니다. */
const HISTORY_LIMIT = 100;

/**
 * Postgres 를 뒤에 둔 `SongStore`.
 *
 * 대기열은 길어야 수십 곡이라 통째로 메모리에 들고 다니고, 바뀔 때마다 전체를
 * 다시 씁니다(`replaceSongs`). 순서 바꾸기·스킵처럼 여러 행이 한꺼번에 움직이는
 * 동작이 많아서, 행 단위로 diff 를 계산하는 것보다 통째로 교체하는 편이
 * 단순하고 실수가 없습니다. 이 규모에서는 성능 차이도 없습니다.
 */
export class PrismaSongStore implements SongStore {
  private songs: SongRequest[];
  private readonly log: Logger;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly repository: BotRuntimeRepository,
    private readonly tenantId: string,
    initial: SongRequest[],
    logger: Logger
  ) {
    this.songs = initial;
    this.log = logger.child('songs');
  }

  static async open(
    repository: BotRuntimeRepository,
    tenantId: string,
    logger: Logger = noopLogger
  ): Promise<PrismaSongStore> {
    const { playing, pending, history } = await repository.songs(tenantId);
    const initial = [...history.slice().reverse(), ...(playing ? [playing] : []), ...pending];
    return new PrismaSongStore(repository, tenantId, initial, logger);
  }

  pending(): SongRequest[] {
    return this.songs.filter((s) => s.status === 'queued');
  }

  playing(): SongRequest | undefined {
    return this.songs.find((s) => s.status === 'playing');
  }

  all(): SongRequest[] {
    return [...this.songs];
  }

  pendingCountBy(channelId: string): number {
    return this.pending().filter((s) => s.requesterChannelId === channelId).length;
  }

  hasPendingTitle(title: string): boolean {
    const key = title.trim().toLowerCase();
    return this.pending().some((s) => s.title.trim().toLowerCase() === key);
  }

  add(input: {
    title: string;
    requesterChannelId: string;
    requesterNickname: string;
    pointsSpent?: number;
  }): SongRequest {
    const song: SongRequest = {
      // DB 가 cuid 를 새로 매기지만, 여기서 만든 id 로 이미 응답을 보낸 뒤라
      // 로컬에서도 고유한 값이 필요합니다.
      id: `song_${randomUUID().slice(0, 8)}`,
      title: input.title.trim(),
      requesterChannelId: input.requesterChannelId,
      requesterNickname: input.requesterNickname,
      status: 'queued',
      requestedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      pointsSpent: input.pointsSpent ?? 0,
    };

    this.songs.push(song);
    this.markDirty();
    return song;
  }

  next(): SongRequest | null {
    const now = Date.now();
    for (const song of this.songs) {
      if (song.status === 'playing') {
        song.status = 'done';
        song.finishedAt = now;
      }
    }

    const upcoming = this.songs.find((s) => s.status === 'queued');
    if (upcoming) {
      upcoming.status = 'playing';
      upcoming.startedAt = now;
    }

    this.trimHistory();
    this.markDirty();
    return upcoming ? { ...upcoming } : null;
  }

  skip(id?: string): SongRequest | null {
    const target = id
      ? this.songs.find((s) => s.id === id)
      : (this.songs.find((s) => s.status === 'playing') ??
        this.songs.find((s) => s.status === 'queued'));

    if (!target || target.status === 'done' || target.status === 'skipped') return null;

    target.status = 'skipped';
    target.finishedAt = Date.now();
    this.trimHistory();
    this.markDirty();
    return { ...target };
  }

  cancelOwn(channelId: string): SongRequest | null {
    for (let i = this.songs.length - 1; i >= 0; i -= 1) {
      const song = this.songs[i];
      if (song?.status === 'queued' && song.requesterChannelId === channelId) {
        this.songs.splice(i, 1);
        this.markDirty();
        return { ...song };
      }
    }
    return null;
  }

  remove(id: string): boolean {
    const before = this.songs.length;
    this.songs = this.songs.filter((s) => s.id !== id);
    if (this.songs.length === before) return false;
    this.markDirty();
    return true;
  }

  move(id: string, direction: 'up' | 'down'): boolean {
    // 대기 중인 곡들의 실제 인덱스만 뽑아 그 안에서 교환합니다.
    const indexes = this.songs
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => song.status === 'queued')
      .map(({ index }) => index);

    const at = indexes.findIndex((index) => this.songs[index]?.id === id);
    if (at < 0) return false;

    const swapWith = direction === 'up' ? at - 1 : at + 1;
    if (swapWith < 0 || swapWith >= indexes.length) return false;

    const a = indexes[at]!;
    const b = indexes[swapWith]!;
    const temp = this.songs[a]!;
    this.songs[a] = this.songs[b]!;
    this.songs[b] = temp;

    this.markDirty();
    return true;
  }

  clearPending(): number {
    const before = this.songs.length;
    this.songs = this.songs.filter((s) => s.status !== 'queued');
    const removed = before - this.songs.length;
    if (removed > 0) this.markDirty();
    return removed;
  }

  flush(): Promise<void> {
    if (!this.dirty) return this.writing;

    const snapshot = this.songs.map((s) => ({ ...s }));
    this.dirty = false;

    this.writing = this.writing.then(async () => {
      try {
        await this.repository.replaceSongs(this.tenantId, snapshot);
      } catch (error) {
        this.dirty = true;
        this.log.error('신청곡 저장에 실패했습니다.', error);
      }
    });

    return this.writing;
  }

  private markDirty(): void {
    this.dirty = true;
    // 신청곡은 사람이 눈으로 보며 조작하는 값이라, 모아 두지 않고 바로 씁니다.
    // 대기열 하나에 수십 행이라 비용도 무시할 만합니다.
    void this.flush();
  }

  private trimHistory(): void {
    const finished = this.songs.filter((s) => s.status === 'done' || s.status === 'skipped');
    if (finished.length <= HISTORY_LIMIT) return;

    const excess = new Set(finished.slice(0, finished.length - HISTORY_LIMIT).map((s) => s.id));
    this.songs = this.songs.filter((s) => !excess.has(s.id));
  }
}
