import { z } from 'zod';
import { platformRole, tenantStatus, userStatus } from './identity.js';
import { subscriptionStatus } from './billing.js';

/**
 * 내부 관리자 콘솔이 쓰는 계약.
 *
 * 여기 있는 엔드포인트는 전부 남의 데이터를 다룹니다. 그래서 조회를 뺀 모든
 * 동작에 `reason` 을 필수로 받고 감사 로그에 남깁니다. "누가 왜 이 사용자를
 * 정지시켰는가" 에 답할 수 없는 관리 기능은 만들지 않습니다.
 */

// ─── 사용자 관리 ──────────────────────────────────────────────────────────────

export const adminUserQuery = z.object({
  /** 채널명 · 채널 ID · 이메일 부분 일치 */
  q: z.string().max(100).default(''),
  status: userStatus.optional(),
  platformRole: platformRole.optional(),
  subscriptionStatus: subscriptionStatus.optional(),
  sort: z.enum(['createdAt', 'lastLoginAt', 'channelName']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type AdminUserQuery = z.infer<typeof adminUserQuery>;

export const adminUserRow = z.object({
  id: z.string(),
  chzzkChannelId: z.string(),
  channelName: z.string(),
  profileImageUrl: z.string().nullable(),
  email: z.string().nullable(),
  platformRole,
  status: userStatus,
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  /** 이 사람이 소유한 테넌트 수 */
  tenantCount: z.number().int(),
  /** 대표 테넌트의 플랜/구독 — 목록에서 한눈에 보려고 함께 내려줍니다. */
  planCode: z.string().nullable(),
  subscriptionStatus: subscriptionStatus.nullable(),
  /** 누적 결제액(원) */
  lifetimeRevenue: z.number().int(),
});
export type AdminUserRow = z.infer<typeof adminUserRow>;

export const suspendUserRequest = z.object({
  reason: z.string().min(1, '사유를 입력하세요.').max(500),
  /** 비우면 무기한 */
  until: z.string().datetime().optional(),
  /** 이 사람의 봇도 즉시 멈출지 */
  stopBots: z.boolean().default(true),
});
export type SuspendUserRequest = z.infer<typeof suspendUserRequest>;

export const changePlatformRoleRequest = z.object({
  platformRole,
  reason: z.string().min(1, '사유를 입력하세요.').max(500),
});
export type ChangePlatformRoleRequest = z.infer<typeof changePlatformRoleRequest>;

// ─── 테넌트(채널) 관리 ────────────────────────────────────────────────────────

export const adminTenantRow = z.object({
  id: z.string(),
  slug: z.string(),
  chzzkChannelId: z.string(),
  channelName: z.string(),
  status: tenantStatus,
  ownerName: z.string(),
  ownerId: z.string(),
  planCode: z.string().nullable(),
  subscriptionStatus: subscriptionStatus.nullable(),
  botStatus: z.string(),
  memberCount: z.number().int(),
  commandCount: z.number().int(),
  createdAt: z.string(),
});
export type AdminTenantRow = z.infer<typeof adminTenantRow>;

export const overrideSubscriptionRequest = z.object({
  planCode: z.string().min(1),
  /** 결제 없이 이 시각까지 열어줍니다. 파트너·베타 테스터에 씁니다. */
  periodEnd: z.string().datetime(),
  reason: z.string().min(1, '사유를 입력하세요.').max(500),
});
export type OverrideSubscriptionRequest = z.infer<typeof overrideSubscriptionRequest>;

// ─── 감사 로그 ────────────────────────────────────────────────────────────────

export const auditActorType = z.enum(['USER', 'STAFF', 'SYSTEM', 'WEBHOOK']);
export type AuditActorType = z.infer<typeof auditActorType>;

export const auditLogRow = z.object({
  id: z.string(),
  actorType: auditActorType,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  /** "user.suspend", "subscription.refund" 처럼 점으로 구분한 동사 */
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  tenantId: z.string().nullable(),
  reason: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogRow = z.infer<typeof auditLogRow>;

export const auditLogQuery = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  tenantId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuery>;

// ─── 공지 ─────────────────────────────────────────────────────────────────────

export const announcementLevel = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export type AnnouncementLevel = z.infer<typeof announcementLevel>;

export const announcement = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  level: announcementLevel,
  publishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Announcement = z.infer<typeof announcement>;

export const upsertAnnouncementRequest = z.object({
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  level: announcementLevel.default('INFO'),
  /** 비우면 초안으로 저장합니다. */
  publishedAt: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
});
export type UpsertAnnouncementRequest = z.infer<typeof upsertAnnouncementRequest>;

// ─── 기능 플래그 ──────────────────────────────────────────────────────────────

export const featureFlag = z.object({
  id: z.string(),
  key: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  /** 0~100. enabled 가 true 일 때만 의미가 있습니다. */
  rolloutPercent: z.number().int().min(0).max(100),
  /** rolloutPercent 와 무관하게 항상 켜줄 테넌트 */
  allowTenantIds: z.array(z.string()),
  updatedAt: z.string(),
});
export type FeatureFlag = z.infer<typeof featureFlag>;

export const upsertFeatureFlagRequest = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z][a-z0-9-]*$/, '소문자·숫자·하이픈만 쓸 수 있습니다.'),
  description: z.string().max(300).default(''),
  enabled: z.boolean().default(false),
  rolloutPercent: z.number().int().min(0).max(100).default(0),
  allowTenantIds: z.array(z.string()).default([]),
});
export type UpsertFeatureFlagRequest = z.infer<typeof upsertFeatureFlagRequest>;

// ─── 대시보드 지표 ────────────────────────────────────────────────────────────

export interface AdminMetrics {
  users: { total: number; activeLast7Days: number; newLast7Days: number; suspended: number };
  tenants: { total: number; active: number; suspended: number };
  bots: { running: number; joined: number; error: number };
  revenue: {
    /** 월 반복 매출(원) */
    mrr: number;
    thisMonth: number;
    lastMonth: number;
    failedPaymentsLast7Days: number;
  };
  subscriptions: Record<string, number>;
  planBreakdown: { planCode: string; count: number }[];
}
