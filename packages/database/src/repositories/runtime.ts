import type {
  BotInstanceState,
  BotInstanceStatus,
  BotStats,
  LogEntry,
  LogKind,
  SongRequest,
} from '@chzzk-bot/contracts';
import { HEARTBEAT_TIMEOUT_MS } from '@chzzk-bot/platform-config';
import type { BotInstance, PrismaClient } from '../client.js';

/**
 * 봇 런타임 상태 · 이벤트 로그 · 신청곡 저장소.
 *
 * Core 워커와 API 서버가 함께 보는 유일한 창구입니다. 워커가 갑자기 죽으면
 * 상태 컬럼은 RUNNING 인 채로 굳어버리므로, 상태를 **읽는 쪽**에서 하트비트를
 * 함께 보고 판정합니다 (`toInstanceState`).
 */
export class BotRuntimeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async get(tenantId: string): Promise<BotInstanceState | null> {
    const row = await this.prisma.botInstance.findUnique({ where: { tenantId } });
    return row ? toInstanceState(row) : null;
  }

  async listByWorker(workerId: string): Promise<BotInstanceState[]> {
    const rows = await this.prisma.botInstance.findMany({ where: { workerId } });
    return rows.map(toInstanceState);
  }

  /** 이 워커가 맡아야 할 채널 — 구독이 살아 있고 사용자가 켜 둔 곳 */
  async listStartable(limit: number): Promise<{ tenantId: string; chzzkChannelId: string }[]> {
    const rows = await this.prisma.tenant.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        owner: { status: 'ACTIVE' },
        subscription: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'] } },
      },
      select: { id: true, chzzkChannelId: true },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ tenantId: r.id, chzzkChannelId: r.chzzkChannelId }));
  }

  async setStatus(
    tenantId: string,
    patch: {
      status: BotInstanceStatus;
      /** null 을 주면 소유 워커를 비웁니다 — 봇을 내릴 때 반드시 그렇게 해야 합니다. */
      workerId?: string | null;
      joinedBy?: string | null;
      joinedAt?: Date | null;
      chatChannelId?: string | null;
      sessionKey?: string | null;
      lastError?: string | null;
    }
  ): Promise<void> {
    const data = {
      status: patch.status,
      ...(patch.workerId !== undefined ? { workerId: patch.workerId } : {}),
      ...(patch.joinedBy !== undefined ? { joinedBy: patch.joinedBy } : {}),
      ...(patch.joinedAt !== undefined ? { joinedAt: patch.joinedAt } : {}),
      ...(patch.chatChannelId !== undefined ? { chatChannelId: patch.chatChannelId } : {}),
      ...(patch.sessionKey !== undefined ? { sessionKey: patch.sessionKey } : {}),
      ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
      lastHeartbeatAt: new Date(),
      ...(patch.status === 'STARTING' ? { startedAt: new Date() } : {}),
    };

    await this.prisma.botInstance.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
  }

  /** 살아 있다는 신호 + 통계 스냅샷. 워커가 주기적으로 부릅니다. */
  async heartbeat(tenantId: string, stats: BotStats | null): Promise<void> {
    await this.prisma.botInstance.updateMany({
      where: { tenantId },
      data: {
        lastHeartbeatAt: new Date(),
        ...(stats ? { statsSnapshot: stats } : {}),
      },
    });
  }

  /**
   * 죽은 워커가 남긴 상태를 정리합니다.
   *
   * 워커가 SIGKILL 로 죽으면 스스로 STOPPED 를 쓸 기회가 없습니다. 그대로 두면
   * 대시보드는 계속 "입장 완료" 라고 거짓말하고, 새 워커는 이미 누가 맡고 있다고
   * 판단해 그 채널을 건너뜁니다.
   */
  async reapStale(): Promise<number> {
    const threshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
    const { count } = await this.prisma.botInstance.updateMany({
      where: {
        status: { in: ['STARTING', 'IDLE', 'JOINED'] },
        lastHeartbeatAt: { lt: threshold },
      },
      data: {
        status: 'ERROR',
        lastError: '워커 응답이 끊겼습니다. 곧 자동으로 다시 연결합니다.',
        workerId: null,
      },
    });
    return count;
  }

  // ─── 이벤트 로그 ───────────────────────────────────────────────────────────

  async appendEvents(
    tenantId: string,
    entries: { kind: LogKind; message: string; actor?: string; detail?: string; at: number }[]
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.prisma.botEvent.createMany({
      data: entries.map((e) => ({
        tenantId,
        kind: e.kind,
        message: e.message,
        actor: e.actor ?? null,
        detail: e.detail ?? null,
        createdAt: new Date(e.at),
      })),
    });
  }

  async recentEvents(tenantId: string, limit = 120): Promise<LogEntry[]> {
    const rows = await this.prisma.botEvent.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // 화면은 최신이 위인데 id 는 오름차순이어야 "since" 폴링이 성립합니다.
    return rows.reverse().map((row, index) => ({
      id: index + 1,
      at: row.createdAt.getTime(),
      kind: row.kind,
      message: row.message,
      ...(row.actor ? { actor: row.actor } : {}),
      ...(row.detail ? { detail: row.detail } : {}),
    }));
  }

  /** 플랜별 보관 기간이 지난 로그를 지웁니다. 배치가 하루 한 번 부릅니다. */
  async pruneEvents(tenantId: string, retentionDays: number): Promise<number> {
    const { count } = await this.prisma.botEvent.deleteMany({
      where: { tenantId, createdAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
    });
    return count;
  }

  // ─── 신청곡 ────────────────────────────────────────────────────────────────

  async songs(tenantId: string): Promise<{
    playing: SongRequest | null;
    pending: SongRequest[];
    history: SongRequest[];
  }> {
    const rows = await this.prisma.songRequest.findMany({
      where: { tenantId },
      orderBy: { requestedAt: 'asc' },
      take: 200,
    });

    const mapped = rows.map(toSong);
    return {
      playing: mapped.find((s) => s.status === 'playing') ?? null,
      pending: mapped.filter((s) => s.status === 'queued'),
      history: mapped
        .filter((s) => s.status === 'done' || s.status === 'skipped')
        .slice(-20)
        .reverse(),
    };
  }

  async replaceSongs(tenantId: string, songs: SongRequest[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.songRequest.deleteMany({ where: { tenantId } }),
      this.prisma.songRequest.createMany({
        data: songs.map((s) => ({
          tenantId,
          title: s.title,
          requesterChannelId: s.requesterChannelId,
          requesterNickname: s.requesterNickname,
          status: s.status,
          pointsSpent: s.pointsSpent,
          requestedAt: new Date(s.requestedAt),
          startedAt: s.startedAt ? new Date(s.startedAt) : null,
          finishedAt: s.finishedAt ? new Date(s.finishedAt) : null,
        })),
      }),
    ]);
  }
}

function toInstanceState(row: BotInstance): BotInstanceState {
  // 하트비트가 끊긴 인스턴스를 살아 있다고 보고하지 않습니다.
  const stale =
    row.lastHeartbeatAt !== null &&
    Date.now() - row.lastHeartbeatAt.getTime() > HEARTBEAT_TIMEOUT_MS;
  const running = row.status === 'STARTING' || row.status === 'IDLE' || row.status === 'JOINED';

  return {
    tenantId: row.tenantId,
    status: stale && running ? 'ERROR' : row.status,
    joinedBy: row.joinedBy,
    joinedAt: row.joinedAt?.toISOString() ?? null,
    chatChannelId: row.chatChannelId,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    lastError:
      stale && running ? '워커 응답이 끊겼습니다. 곧 자동으로 다시 연결합니다.' : row.lastError,
    stats: (row.statsSnapshot as BotStats | null) ?? null,
  };
}

function toSong(row: {
  id: string;
  title: string;
  requesterChannelId: string;
  requesterNickname: string;
  status: SongRequest['status'];
  pointsSpent: number;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): SongRequest {
  return {
    id: row.id,
    title: row.title,
    requesterChannelId: row.requesterChannelId,
    requesterNickname: row.requesterNickname,
    status: row.status,
    requestedAt: row.requestedAt.getTime(),
    startedAt: row.startedAt?.getTime() ?? null,
    finishedAt: row.finishedAt?.getTime() ?? null,
    pointsSpent: row.pointsSpent,
  };
}
