import type { ViewerRecord } from '@chzzk-bot/contracts';
import type { PrismaClient } from '../client.js';
import type { Viewer as DbViewer } from '../client.js';

/**
 * 시청자 포인트·출석 저장소.
 *
 * 채팅 1건마다 갱신되는 유일한 경로라 성능이 곧 기능입니다. Core 는 메모리에서
 * 계산하고 이 리포지토리로 **묶어서** 내려씁니다. 여기 있는 `flushMany` 가 그
 * 접점이고, 개별 갱신 메서드는 대시보드(사람이 누르는 버튼)용입니다.
 */
export class ViewerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async all(tenantId: string, limit = 200): Promise<ViewerRecord[]> {
    const rows = await this.prisma.viewer.findMany({
      where: { tenantId },
      orderBy: { points: 'desc' },
      take: limit,
    });
    return rows.map(toViewer);
  }

  async count(tenantId: string): Promise<number> {
    return this.prisma.viewer.count({ where: { tenantId } });
  }

  async get(tenantId: string, chzzkChannelId: string): Promise<ViewerRecord | null> {
    const row = await this.prisma.viewer.findUnique({
      where: { tenantId_chzzkChannelId: { tenantId, chzzkChannelId } },
    });
    return row ? toViewer(row) : null;
  }

  /**
   * 메모리에 쌓인 변경분을 한 번에 내려씁니다.
   *
   * 트랜잭션으로 묶는 이유는 원자성보다 **왕복 횟수** 입니다. 시청자 500명을
   * 개별 upsert 로 보내면 500번의 왕복이지만, 트랜잭션 하나면 한 번입니다.
   */
  async flushMany(tenantId: string, viewers: ViewerRecord[]): Promise<void> {
    if (viewers.length === 0) return;

    await this.prisma.$transaction(
      viewers.map((v) =>
        this.prisma.viewer.upsert({
          where: { tenantId_chzzkChannelId: { tenantId, chzzkChannelId: v.channelId } },
          create: {
            tenantId,
            chzzkChannelId: v.channelId,
            nickname: v.nickname,
            points: v.points,
            chatCount: v.chatCount,
            firstSeenAt: new Date(v.firstSeenAt),
            lastSeenAt: new Date(v.lastSeenAt),
            attendanceStreak: v.attendanceStreak,
            lastAttendanceDate: v.lastAttendanceDate,
          },
          update: {
            nickname: v.nickname,
            points: v.points,
            chatCount: v.chatCount,
            lastSeenAt: new Date(v.lastSeenAt),
            attendanceStreak: v.attendanceStreak,
            lastAttendanceDate: v.lastAttendanceDate,
          },
        })
      )
    );
  }

  /**
   * 포인트를 더하거나 뺍니다(관리자 지급/회수).
   *
   * `increment` 로 처리해 봇이 같은 시각에 적립한 포인트를 덮어쓰지 않게 합니다.
   * 음수 결과는 DB 에서 막을 수 없어 뒤이어 한 번 바로잡습니다.
   */
  async adjustPoints(
    tenantId: string,
    chzzkChannelId: string,
    delta: number,
    nickname = ''
  ): Promise<number> {
    const row = await this.prisma.viewer.upsert({
      where: { tenantId_chzzkChannelId: { tenantId, chzzkChannelId } },
      create: {
        tenantId,
        chzzkChannelId,
        nickname,
        points: Math.max(0, delta),
      },
      update: {
        points: { increment: delta },
        ...(nickname ? { nickname } : {}),
      },
    });

    if (row.points >= 0) return row.points;

    const fixed = await this.prisma.viewer.update({
      where: { id: row.id },
      data: { points: 0 },
    });
    return fixed.points;
  }

  async resetAllPoints(tenantId: string): Promise<number> {
    const { count } = await this.prisma.viewer.updateMany({
      where: { tenantId },
      data: { points: 0 },
    });
    return count;
  }
}

function toViewer(row: DbViewer): ViewerRecord {
  return {
    channelId: row.chzzkChannelId,
    nickname: row.nickname,
    points: row.points,
    chatCount: row.chatCount,
    firstSeenAt: row.firstSeenAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    attendanceStreak: row.attendanceStreak,
    lastAttendanceDate: row.lastAttendanceDate,
  };
}
