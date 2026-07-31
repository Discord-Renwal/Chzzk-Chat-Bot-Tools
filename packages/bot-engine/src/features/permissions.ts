import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { PermissionSettings, UserRoleCodeValue } from '@chzzk-bot/contracts';

/** 치지직이 보내주는 역할 코드가 스키마의 값 중 하나인지 확인합니다. */
export function normalizeRole(role: string): UserRoleCodeValue {
  switch (role) {
    case 'streamer':
    case 'streaming_channel_manager':
    case 'streaming_chat_manager':
      return role;
    default:
      return 'common_user';
  }
}

/**
 * 관리자 판정.
 *
 * 역할이 스트리머/매니저이거나, 설정에서 채널 ID 를 직접 관리자로 등록한 경우입니다.
 * ID 직접 등록은 매니저 권한을 주지 않고 봇만 맡기고 싶을 때 씁니다.
 */
export function isAdmin(event: ChatEvent, permissions: PermissionSettings): boolean {
  if (permissions.extraAdminChannelIds.includes(event.senderChannelId)) return true;
  return permissions.manageCommands.includes(normalizeRole(event.userRoleCode));
}

/**
 * 봇을 방에 들이거나 내보낼 수 있는지 (`!입장` / `!퇴장`).
 *
 * `isAdmin` 을 쓰지 않는 이유가 있습니다. `isAdmin` 은 설정값
 * `permissions.manageCommands` 를 따르는데, 그 기본값에는 **채팅 매니저가
 * 빠져 있습니다** — 명령어를 만들고 지우는 권한이라 좁게 잡은 것이 맞습니다.
 * 하지만 봇을 부르는 일은 그것과 성격이 다릅니다. 방송 중에 채팅 매니저가
 * 봇을 못 불러서 스트리머가 직접 쳐야 한다면, 그건 설정이 아니라 결함입니다.
 *
 * 그래서 여기서는 치지직이 매니저로 인정한 사람이면 모두 허용하고, 설정에서
 * 관리자로 등록한 채널 ID 도 함께 봅니다. 되돌릴 수 있는 동작이라 위험도 낮습니다.
 */
export function canControlBot(event: ChatEvent, permissions: PermissionSettings): boolean {
  if (permissions.extraAdminChannelIds.includes(event.senderChannelId)) return true;

  const role = normalizeRole(event.userRoleCode);
  return (
    role === 'streamer' || role === 'streaming_channel_manager' || role === 'streaming_chat_manager'
  );
}

/** 봇이 이 사람의 메시지를 아예 무시해야 하는지 */
export function isIgnored(event: ChatEvent, permissions: PermissionSettings): boolean {
  return permissions.ignoredChannelIds.includes(event.senderChannelId);
}

/** 역할 기반 허용 여부 (관리자는 항상 통과) */
export function hasRole(
  event: ChatEvent,
  allowed: UserRoleCodeValue[],
  permissions: PermissionSettings
): boolean {
  if (isAdmin(event, permissions)) return true;
  return allowed.includes(normalizeRole(event.userRoleCode));
}
