import {
  platformRoleAtLeast,
  tenantRoleAtLeast,
  type PlatformRole,
  type TenantRole,
} from '@chzzk-bot/contracts';

/**
 * 권한 검사.
 *
 * 규칙을 함수 하나하나로 쪼개지 않고 **동작 이름**으로 표현합니다. 라우트에서
 * `if (user.platformRole === 'OPERATOR' || user.platformRole === 'SUPER_ADMIN')`
 * 같은 조건을 반복하면, 역할을 하나 추가하는 순간 빠뜨린 곳이 생깁니다.
 * `can.refundPayment(role)` 처럼 쓰면 그런 곳이 남지 않습니다.
 */

/** 내부 관리자 콘솔에서 할 수 있는 일 */
export const staffCan = {
  /** 사용자·테넌트 목록과 상세를 본다 */
  viewUsers: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'SUPPORT'),
  /** 구독·결제 내역을 본다 */
  viewBilling: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'SUPPORT'),
  /** 감사 로그를 본다 */
  viewAuditLog: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),

  /** 계정을 정지하거나 푼다 */
  suspendUser: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),
  /** 봇을 강제로 멈추거나 다시 띄운다 */
  controlBot: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),
  /** 결제 없이 플랜을 열어 준다 */
  overrideSubscription: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),
  /** 환불한다 — 돈이 나가는 동작이라 운영자 이상만 */
  refundPayment: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),
  /** 공지를 쓴다 */
  manageAnnouncements: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),
  /** 기능 플래그를 켜고 끈다 */
  manageFeatureFlags: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'OPERATOR'),

  /** 다른 사람을 내부 관리자로 임명한다 — 최고 관리자만 */
  managePlatformRoles: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'SUPER_ADMIN'),
  /** 사용자 데이터를 실제로 지운다 — 최고 관리자만 */
  deleteUser: (role: PlatformRole): boolean => platformRoleAtLeast(role, 'SUPER_ADMIN'),
} as const;

/** 채널(테넌트) 안에서 할 수 있는 일 */
export const tenantCan = {
  /** 대시보드를 본다 */
  view: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'VIEWER'),
  /** 봇 설정을 바꾼다 */
  editBotConfig: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'MANAGER'),
  /** 봇을 입장/퇴장시킨다 */
  controlBot: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'MANAGER'),
  /** 시청자 포인트를 지급·회수한다 */
  managePoints: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'MANAGER'),
  /** 치지직 제재·채팅설정을 바꾼다 */
  moderateChannel: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'MANAGER'),

  /** 매니저를 초대하고 내보낸다 — 채널 주인만 */
  manageMembers: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'OWNER'),
  /** 결제 수단과 플랜을 바꾼다 — 채널 주인만 */
  manageBilling: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'OWNER'),
  /** API 키를 발급한다 — 채널 주인만 */
  manageApiKeys: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'OWNER'),
  /** 채널을 삭제한다 — 채널 주인만 */
  deleteTenant: (role: TenantRole): boolean => tenantRoleAtLeast(role, 'OWNER'),
} as const;

export type StaffAction = keyof typeof staffCan;
export type TenantAction = keyof typeof tenantCan;
