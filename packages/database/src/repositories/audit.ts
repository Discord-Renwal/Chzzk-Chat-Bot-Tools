import type { AuditActorType, AuditLogRow } from '@chzzk-bot/contracts';
import type { Prisma, PrismaClient } from '../client.js';

export interface AuditEntry {
  actorType: AuditActorType;
  actorId?: string | undefined;
  actorName?: string | undefined;
  /** "user.suspend", "subscription.refund" 처럼 점으로 구분한 동사 */
  action: string;
  targetType?: string | undefined;
  targetId?: string | undefined;
  tenantId?: string | undefined;
  reason?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * 감사 로그.
 *
 * 수정과 삭제 메서드가 **없는 것이 설계**입니다. 나중에 필요해 보여도 넣지
 * 마세요 — 고칠 수 있는 기록은 증거로 쓸 수 없습니다.
 */
export class AuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * 기록에 실패해도 본 작업을 되돌리지 않습니다.
   *
   * 감사 로그 쓰기가 실패했다고 사용자 정지를 취소하면, 정작 위험한 동작만
   * 성공하고 기록만 사라지는 최악의 조합이 됩니다. 대신 절대 조용히 넘기지
   * 않도록 호출자가 넘긴 로거로 반드시 알립니다.
   */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        tenantId: entry.tenantId ?? null,
        reason: entry.reason ?? null,
        metadata: (entry.metadata ?? null) as Prisma.InputJsonValue,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  async list(
    filter: {
      actorId?: string | undefined;
      action?: string | undefined;
      tenantId?: string | undefined;
      from?: Date | undefined;
      to?: Date | undefined;
    },
    page: { page: number; size: number }
  ): Promise<{ rows: AuditLogRow[]; total: number }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.action ? { action: { startsWith: filter.action } } : {}),
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page.page - 1) * page.size,
        take: page.size,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      total,
      rows: rows.map((row) => ({
        id: row.id,
        actorType: row.actorType,
        actorId: row.actorId,
        actorName: row.actorName,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        tenantId: row.tenantId,
        reason: row.reason,
        metadata: (row.metadata as Record<string, unknown> | null) ?? null,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
