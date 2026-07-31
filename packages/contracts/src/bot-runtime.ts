import { z } from 'zod';

/**
 * Core(봇 런타임)와 주고받는 계약.
 *
 * API 서버는 봇을 직접 돌리지 않고 Core 에게 시킵니다. 두 프로세스가 따로 뜨는
 * 이상 이 파일이 유일한 접점이며, 여기 없는 필드는 존재하지 않는 것으로 봅니다.
 */

// ─── 봇 인스턴스 상태 ─────────────────────────────────────────────────────────

export const botInstanceStatus = z.enum([
  /** 꺼져 있음. 사용자가 껐거나 구독이 만료됨 */
  'STOPPED',
  /** 세션을 여는 중 */
  'STARTING',
  /**
   * 채팅을 듣고 있지만 아직 방에 "입장" 하지 않음.
   * 스트리머나 매니저가 `!입장` 을 쳐야 실제 응답을 시작합니다.
   */
  'IDLE',
  /** 입장 완료. 명령어에 응답합니다. */
  'JOINED',
  /** 세션 오류. lastError 를 보세요. */
  'ERROR',
]);
export type BotInstanceStatus = z.infer<typeof botInstanceStatus>;

export const BOT_STATUS_LABELS: Record<BotInstanceStatus, string> = {
  STOPPED: '중지됨',
  STARTING: '연결 중',
  IDLE: '대기 중 (!입장 필요)',
  JOINED: '입장 완료',
  ERROR: '오류',
};

export const botStats = z.object({
  startedAt: z.number(),
  messagesSeen: z.number(),
  commandsRun: z.number(),
  autoResponsesSent: z.number(),
  moderationActions: z.number(),
  spamBlocked: z.number(),
  pointsAwarded: z.number(),
  lastChatAt: z.number().nullable(),
  uniqueChatters: z.number(),
});
export type BotStats = z.infer<typeof botStats>;

export const botInstanceState = z.object({
  tenantId: z.string(),
  status: botInstanceStatus,
  /** `!입장` 을 친 사람의 닉네임. 아직 입장 전이면 null */
  joinedBy: z.string().nullable(),
  joinedAt: z.string().nullable(),
  /** 마지막으로 관측한 채팅 채널 ID (임시제한 해제에 필요) */
  chatChannelId: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  lastError: z.string().nullable(),
  stats: botStats.nullable(),
});
export type BotInstanceState = z.infer<typeof botInstanceState>;

// ─── 명령 실행 API ────────────────────────────────────────────────────────────

/**
 * 채팅을 거치지 않고 명령을 실행해 결과 문자열을 바로 받습니다.
 *
 * 대시보드의 "미리보기" 와 외부 연동(오버레이·디스코드 등)이 같은 경로를 씁니다.
 * 채팅 파이프라인과 **같은 엔진**을 타므로, 미리보기에서 본 문장이 실제 채팅과
 * 달라질 일이 없습니다.
 */
export const executeCommandRequest = z.object({
  /** 접두사를 뺀 명령 이름. 예: "멤버" */
  command: z.string().min(1).max(60),
  args: z.array(z.string()).max(20).default([]),
  /** 호출자를 흉내 냅니다. 비우면 시스템 호출로 봅니다. */
  actor: z
    .object({
      channelId: z.string().min(1),
      nickname: z.string().default(''),
      role: z
        .enum(['streamer', 'streaming_channel_manager', 'streaming_chat_manager', 'common_user'])
        .default('common_user'),
    })
    .optional(),
  /**
   * true 면 결과를 실제 채팅에도 보냅니다.
   * 기본은 false — 미리보기가 방송에 새어 나가면 안 됩니다.
   */
  broadcast: z.boolean().default(false),
  /** 쿨다운·권한 검사를 건너뜁니다. 관리자 미리보기 전용입니다. */
  dryRun: z.boolean().default(true),
});
export type ExecuteCommandRequest = z.infer<typeof executeCommandRequest>;

export const executeCommandResponse = z.object({
  /** 이 이름을 처리하는 명령이 있었는지 */
  handled: z.boolean(),
  /** 봇이 내보낼 문장. 처리했지만 응답이 없는 명령이면 빈 문자열 */
  output: z.string(),
  /** 어느 계층이 처리했는지 — 이름이 가려지는 문제를 디버깅할 때 씁니다. */
  source: z.enum(['builtin', 'custom', 'game', 'help', 'none']),
  /** 실제 채팅으로 보냈는지 */
  broadcast: z.boolean(),
  /** 막혔다면 그 이유 (쿨다운·권한·기능 꺼짐) */
  blockedReason: z.string().nullable(),
  elapsedMs: z.number(),
});
export type ExecuteCommandResponse = z.infer<typeof executeCommandResponse>;

// ─── 시청자 / 신청곡 / 이벤트 로그 ────────────────────────────────────────────

export const viewerRecord = z.object({
  channelId: z.string(),
  nickname: z.string(),
  points: z.number().int(),
  chatCount: z.number().int(),
  firstSeenAt: z.number(),
  lastSeenAt: z.number(),
  attendanceStreak: z.number().int(),
  lastAttendanceDate: z.string(),
});
export type ViewerRecord = z.infer<typeof viewerRecord>;

export const songRequestStatus = z.enum(['queued', 'playing', 'done', 'skipped']);
export type SongRequestStatus = z.infer<typeof songRequestStatus>;

export const songRequest = z.object({
  id: z.string(),
  title: z.string(),
  requesterChannelId: z.string(),
  requesterNickname: z.string(),
  status: songRequestStatus,
  requestedAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  pointsSpent: z.number().int(),
});
export type SongRequest = z.infer<typeof songRequest>;

export interface SongsResponse {
  playing: SongRequest | null;
  pending: SongRequest[];
  history: SongRequest[];
}

export const logKind = z.enum([
  'chat',
  'command',
  'auto',
  'moderation',
  'donation',
  'subscription',
  'song',
  'system',
  'error',
]);
export type LogKind = z.infer<typeof logKind>;

export const logEntry = z.object({
  id: z.number(),
  at: z.number(),
  kind: logKind,
  actor: z.string().optional(),
  message: z.string(),
  detail: z.string().optional(),
});
export type LogEntry = z.infer<typeof logEntry>;

/** 관리자 대시보드 첫 화면이 한 번에 받아가는 묶음 */
export interface BotStatusResponse {
  account: { channelId: string; channelName: string } | null;
  instance: BotInstanceState | null;
  stats: BotStats | null;
}
