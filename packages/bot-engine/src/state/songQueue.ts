import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { JsonFile } from './jsonFile.js';
import type { Logger } from '@chzzk-bot/logger';
import type { SongStore } from '../ports.js';

export const songStatus = z.enum(['queued', 'playing', 'done', 'skipped']);
export type SongStatus = z.infer<typeof songStatus>;

export const songRequest = z.object({
  id: z.string(),
  title: z.string(),
  requesterChannelId: z.string(),
  requesterNickname: z.string(),
  status: songStatus.default('queued'),
  requestedAt: z.number(),
  /** 재생 시작/종료 시각 */
  startedAt: z.number().nullable().default(null),
  finishedAt: z.number().nullable().default(null),
  /** 포인트를 소모해 신청했다면 그 값 */
  pointsSpent: z.number().int().min(0).default(0),
});
export type SongRequest = z.infer<typeof songRequest>;

const queueData = z.object({
  version: z.literal(1).default(1),
  songs: z.array(songRequest).default([]),
});
export type QueueData = z.infer<typeof queueData>;

/** 완료/스킵된 곡은 이 개수까지만 남기고 오래된 것부터 버립니다. */
const HISTORY_LIMIT = 100;

/**
 * 신청곡 대기열.
 *
 * 외부 음악 서비스와 연동하지 않습니다. 제목 문자열만 받아 순서를 관리하고,
 * 재생은 스트리머가 직접 합니다. YouTube 연동은 별도 API 키가 필요해 범위에서 뺐습니다.
 */
export class JsonSongStore implements SongStore {
  private constructor(private readonly file: JsonFile<QueueData>) {}

  static async open(filePath = 'data/songs.json', logger?: Logger): Promise<JsonSongStore> {
    const file = await JsonFile.open<QueueData>({
      filePath,
      fallback: () => queueData.parse({}),
      parse: (raw) => queueData.parse(raw),
      ...(logger ? { logger } : {}),
    });
    return new JsonSongStore(file);
  }

  /** 대기 중인 곡만, 신청 순서대로 */
  pending(): SongRequest[] {
    return this.file.current.songs.filter((s) => s.status === 'queued');
  }

  /** 지금 재생 중인 곡 */
  playing(): SongRequest | undefined {
    return this.file.current.songs.find((s) => s.status === 'playing');
  }

  /** 대기열 + 재생 중 + 최근 기록 전체 (대시보드용) */
  all(): SongRequest[] {
    return [...this.file.current.songs];
  }

  /** 이 사람이 대기열에 올려둔 곡 수 */
  pendingCountBy(channelId: string): number {
    return this.pending().filter((s) => s.requesterChannelId === channelId).length;
  }

  /** 같은 제목이 이미 대기 중인지 (중복 신청 차단용) */
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
    const song = songRequest.parse({
      id: `song_${randomUUID().slice(0, 8)}`,
      title: input.title.trim(),
      requesterChannelId: input.requesterChannelId,
      requesterNickname: input.requesterNickname,
      requestedAt: Date.now(),
      pointsSpent: input.pointsSpent ?? 0,
    });

    this.file.update((draft) => {
      draft.songs.push(song);
    });
    return song;
  }

  /**
   * 다음 곡을 재생 상태로 바꿉니다. 재생 중이던 곡은 완료 처리합니다.
   * @returns 새로 재생을 시작한 곡. 대기열이 비었으면 null
   */
  next(): SongRequest | null {
    let started: SongRequest | null = null;

    this.file.update((draft) => {
      const now = Date.now();
      for (const song of draft.songs) {
        if (song.status === 'playing') {
          song.status = 'done';
          song.finishedAt = now;
        }
      }
      const upcoming = draft.songs.find((s) => s.status === 'queued');
      if (upcoming) {
        upcoming.status = 'playing';
        upcoming.startedAt = now;
        started = { ...upcoming };
      }
      trimHistory(draft);
    });

    return started;
  }

  /** 특정 곡을 스킵합니다. id 를 생략하면 재생 중인 곡. */
  skip(id?: string): SongRequest | null {
    let skipped: SongRequest | null = null;

    this.file.update((draft) => {
      const target = id
        ? draft.songs.find((s) => s.id === id)
        : (draft.songs.find((s) => s.status === 'playing') ??
          draft.songs.find((s) => s.status === 'queued'));

      if (!target || target.status === 'done' || target.status === 'skipped') return;
      target.status = 'skipped';
      target.finishedAt = Date.now();
      skipped = { ...target };
      trimHistory(draft);
    });

    return skipped;
  }

  /** 신청자가 자기 곡을 취소합니다. 가장 최근에 넣은 것부터. */
  cancelOwn(channelId: string): SongRequest | null {
    let removed: SongRequest | null = null;

    this.file.update((draft) => {
      for (let i = draft.songs.length - 1; i >= 0; i--) {
        const song = draft.songs[i];
        if (song?.status === 'queued' && song.requesterChannelId === channelId) {
          removed = { ...song };
          draft.songs.splice(i, 1);
          return;
        }
      }
    });

    return removed;
  }

  remove(id: string): boolean {
    let removed = false;
    this.file.update((draft) => {
      const before = draft.songs.length;
      draft.songs = draft.songs.filter((s) => s.id !== id);
      removed = draft.songs.length < before;
    });
    return removed;
  }

  /** 대기열 안에서 순서를 옮깁니다. */
  move(id: string, direction: 'up' | 'down'): boolean {
    let moved = false;

    this.file.update((draft) => {
      // 대기 중인 곡들의 실제 인덱스만 뽑아 그 안에서 교환합니다.
      const indexes = draft.songs
        .map((song, index) => ({ song, index }))
        .filter(({ song }) => song.status === 'queued')
        .map(({ index }) => index);

      const at = indexes.findIndex((index) => draft.songs[index]?.id === id);
      if (at < 0) return;

      const swapWith = direction === 'up' ? at - 1 : at + 1;
      if (swapWith < 0 || swapWith >= indexes.length) return;

      const a = indexes[at]!;
      const b = indexes[swapWith]!;
      const temp = draft.songs[a]!;
      draft.songs[a] = draft.songs[b]!;
      draft.songs[b] = temp;
      moved = true;
    });

    return moved;
  }

  /** 대기 중인 곡을 모두 지웁니다. 기록은 남습니다. */
  clearPending(): number {
    let count = 0;
    this.file.update((draft) => {
      const before = draft.songs.length;
      draft.songs = draft.songs.filter((s) => s.status !== 'queued');
      count = before - draft.songs.length;
    });
    return count;
  }

  flush(): Promise<void> {
    return this.file.flush();
  }
}

function trimHistory(draft: QueueData): void {
  const finished = draft.songs.filter((s) => s.status === 'done' || s.status === 'skipped');
  if (finished.length <= HISTORY_LIMIT) return;

  const excess = new Set(finished.slice(0, finished.length - HISTORY_LIMIT).map((s) => s.id));
  draft.songs = draft.songs.filter((s) => !excess.has(s.id));
}
