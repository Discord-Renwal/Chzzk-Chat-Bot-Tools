import { z } from 'zod';

/**
 * 계정과 권한의 단일 진실 공급원.
 *
 * 권한은 두 축으로 갈립니다.
 *  - **플랫폼 역할**(platformRole): 우리 서비스 안에서의 지위. 내부 관리자인지 아닌지.
 *  - **테넌트 역할**(tenantRole): 특정 채널 워크스페이스 안에서의 지위. 스트리머인지 매니저인지.
 *
 * 둘을 하나로 합치면 "내부 관리자면서 자기 채널에서는 스트리머" 같은 흔한 경우를
 * 표현할 수 없습니다. 실제로 우리 팀원도 자기 채널을 운영합니다.
 */

// ─── 플랫폼 역할 (내부 관리자 구분) ────────────────────────────────────────────

export const platformRole = z.enum([
  /** 일반 고객. 자기 테넌트만 볼 수 있습니다. */
  'MEMBER',
  /** CS 담당. 사용자 조회·구독 확인은 되지만 환불·삭제는 막혀 있습니다. */
  'SUPPORT',
  /** 운영자. 사용자 정지·플랜 변경·환불까지 가능합니다. */
  'OPERATOR',
  /** 최고 관리자. 내부 관리자 임명과 시스템 설정까지 가능합니다. */
  'SUPER_ADMIN',
]);
export type PlatformRole = z.infer<typeof platformRole>;

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  MEMBER: '일반 회원',
  SUPPORT: 'CS 담당',
  OPERATOR: '운영자',
  SUPER_ADMIN: '최고 관리자',
};

/** 내부 관리자 콘솔에 들어올 수 있는 역할 */
export const STAFF_ROLES: readonly PlatformRole[] = ['SUPPORT', 'OPERATOR', 'SUPER_ADMIN'];

export function isStaff(role: PlatformRole): boolean {
  return STAFF_ROLES.includes(role);
}

/**
 * 역할 서열. 숫자가 클수록 넓은 권한입니다.
 * 권한 검사에서 `rankOf(actor) >= rankOf(required)` 로 씁니다.
 */
const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  MEMBER: 0,
  SUPPORT: 1,
  OPERATOR: 2,
  SUPER_ADMIN: 3,
};

export function platformRoleAtLeast(actual: PlatformRole, required: PlatformRole): boolean {
  return PLATFORM_ROLE_RANK[actual] >= PLATFORM_ROLE_RANK[required];
}

// ─── 테넌트 역할 (채널 워크스페이스 안에서의 지위) ─────────────────────────────

export const tenantRole = z.enum([
  /** 채널 주인(스트리머). 결제와 삭제를 포함해 전부 가능합니다. */
  'OWNER',
  /** 매니저. 봇 설정은 바꾸지만 결제와 채널 삭제는 못 합니다. */
  'MANAGER',
  /** 조회 전용. 통계만 봅니다. */
  'VIEWER',
]);
export type TenantRole = z.infer<typeof tenantRole>;

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  OWNER: '스트리머',
  MANAGER: '매니저',
  VIEWER: '조회 전용',
};

const TENANT_ROLE_RANK: Record<TenantRole, number> = { VIEWER: 0, MANAGER: 1, OWNER: 2 };

export function tenantRoleAtLeast(actual: TenantRole, required: TenantRole): boolean {
  return TENANT_ROLE_RANK[actual] >= TENANT_ROLE_RANK[required];
}

// ─── 계정 상태 ────────────────────────────────────────────────────────────────

export const userStatus = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);
export type UserStatus = z.infer<typeof userStatus>;

export const tenantStatus = z.enum([
  /** 정상 */
  'ACTIVE',
  /** 사용자가 스스로 잠시 멈춤 */
  'PAUSED',
  /** 운영자가 정지시킴 (약관 위반 등) */
  'SUSPENDED',
]);
export type TenantStatus = z.infer<typeof tenantStatus>;

// ─── 화면에 내려주는 모양 ─────────────────────────────────────────────────────

export const userProfile = z.object({
  id: z.string(),
  chzzkChannelId: z.string(),
  channelName: z.string(),
  profileImageUrl: z.string().nullable(),
  email: z.string().nullable(),
  platformRole,
  status: userStatus,
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
});
export type UserProfile = z.infer<typeof userProfile>;

export const tenantSummary = z.object({
  id: z.string(),
  slug: z.string(),
  chzzkChannelId: z.string(),
  channelName: z.string(),
  status: tenantStatus,
  /** 지금 로그인한 사람이 이 테넌트에서 갖는 역할 */
  role: tenantRole,
  createdAt: z.string(),
});
export type TenantSummary = z.infer<typeof tenantSummary>;

/**
 * 로그인 직후 프런트가 한 번에 받아가는 묶음.
 *
 * 프로필·소속 테넌트·구독 상태를 따로 부르면 화면이 세 단계로 깜빡입니다.
 * 어차피 전부 필요하므로 한 번에 내려줍니다.
 */
export const sessionUser = z.object({
  user: userProfile,
  tenants: z.array(tenantSummary),
  /** 마지막으로 보던 테넌트. 없으면 첫 번째를 씁니다. */
  activeTenantId: z.string().nullable(),
});
export type SessionUser = z.infer<typeof sessionUser>;
