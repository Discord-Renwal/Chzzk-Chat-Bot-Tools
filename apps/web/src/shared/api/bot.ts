import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AudienceResponse,
  AutoResponse,
  BannedWord,
  BotConfig,
  BotStatusResponse,
  ChatSettings,
  CustomCommand,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  LogEntry,
  PlanLimits,
  RestrictedChannel,
  SongsResponse,
  StreamingRole,
  TimerMessage,
  UserRecord,
} from '../types';
import { ApiError, request } from './client';
import { useTenantId } from './session';

/**
 * 관리자 대시보드가 쓰는 데이터 훅.
 *
 * 모든 경로가 `/tenants/:tenantId/...` 이고, 캐시 키에도 tenantId 가 들어갑니다.
 * 키에 넣지 않으면 채널을 바꿨을 때 이전 채널의 설정이 잠깐 보이다가 갱신되는데,
 * 그 잠깐 사이에 저장을 누르면 **남의 채널 설정을 내 채널에 덮어씁니다**.
 */

export { ApiError };

const keys = {
  config: (tenantId: string) => ['config', tenantId] as const,
  status: (tenantId: string) => ['bot-status', tenantId] as const,
  usage: (tenantId: string) => ['usage', tenantId] as const,
  viewers: (tenantId: string) => ['viewers', tenantId] as const,
  songs: (tenantId: string) => ['songs', tenantId] as const,
  events: (tenantId: string) => ['events', tenantId] as const,
  restrictions: (tenantId: string) => ['restrictions', tenantId] as const,
  chatSettings: (tenantId: string) => ['chat-settings', tenantId] as const,
  audience: (tenantId: string) => ['audience', tenantId] as const,
  managers: (tenantId: string) => ['managers', tenantId] as const,
};

// ─── 설정 ─────────────────────────────────────────────────────────────────────

export function useConfig() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.config(tenantId),
    queryFn: () => request<BotConfig>(`/tenants/${tenantId}/config`),
    enabled: Boolean(tenantId),
    staleTime: 2000,
  });
}

export function useBotStatus() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.status(tenantId),
    queryFn: () => request<BotStatusResponse>(`/tenants/${tenantId}/bot`),
    enabled: Boolean(tenantId),
    // 봇이 살아 있는지, 통계가 어떻게 변하는지 계속 비춰줍니다.
    refetchInterval: 5000,
    retry: false,
  });
}

/** 예전 이름 — 화면 코드가 아직 이렇게 부릅니다. */
export const useStatus = useBotStatus;

export function usePlanUsage() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.usage(tenantId),
    queryFn: () =>
      request<{
        counts: { commands: number; autoResponses: number; bannedWords: number; timers: number };
        limits: PlanLimits | null;
      }>(`/tenants/${tenantId}/usage`),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
}

/**
 * 성공하면 설정을 다시 불러오고 토스트를 띄우는 공통 뮤테이션.
 *
 * 실패 메시지는 서버가 준 문장을 그대로 보여줍니다 — 어느 필드가 왜 막혔는지
 * 서버가 알고 있고, 요금제 한도처럼 화면이 모르는 이유도 있기 때문입니다.
 */
function useConfigMutation<TVars>(
  fn: (tenantId: string, vars: TVars) => Promise<unknown>,
  successMessage: string | ((vars: TVars) => string)
): UseMutationResult<unknown, Error, TVars> {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: TVars) => fn(tenantId, vars),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: keys.config(tenantId) });
      void queryClient.invalidateQueries({ queryKey: keys.usage(tenantId) });
      toast.success(typeof successMessage === 'function' ? successMessage(vars) : successMessage);
    },
    onError: (error: Error) => {
      // 요금제 때문에 막힌 경우는 다음 행동이 분명하므로 안내를 덧붙입니다.
      if (error instanceof ApiError && error.needsUpgrade) {
        toast.error(error.message, {
          action: {
            label: '요금제 보기',
            onClick: () => {
              window.location.href = '/mypage/plan';
            },
          },
        });
        return;
      }
      toast.error(error.message);
    },
  });
}

/** 서버의 부분 저장 엔드포인트와 같은 목록이어야 합니다. */
export type ConfigSection =
  'general' | 'permissions' | 'moderation' | 'points' | 'songs' | 'games' | 'notifications';

export function useSaveSection(section: ConfigSection) {
  return useConfigMutation(
    (tenantId, values: Record<string, unknown>) =>
      request(`/tenants/${tenantId}/config/${section}`, 'PUT', values),
    '저장했습니다.'
  );
}

// ─── 명령어 ──────────────────────────────────────────────────────────────────

export function useCreateCommand() {
  return useConfigMutation(
    (tenantId, values: Partial<CustomCommand>) =>
      request<CustomCommand>(`/tenants/${tenantId}/commands`, 'POST', values),
    (values) => `${values.name ?? '명령어'} 을(를) 만들었습니다.`
  );
}

export function useUpdateCommand() {
  return useConfigMutation(
    (tenantId, { id, ...values }: Partial<CustomCommand> & { id: string }) =>
      request<CustomCommand>(`/tenants/${tenantId}/commands/${id}`, 'PUT', values),
    '저장했습니다.'
  );
}

export function useDeleteCommand() {
  return useConfigMutation(
    (tenantId, id: string) => request(`/tenants/${tenantId}/commands/${id}`, 'DELETE'),
    '삭제했습니다.'
  );
}

/**
 * 명령을 실제로 실행해 보고 결과 문장을 받습니다.
 *
 * 기본은 미리보기라 채팅으로 나가지 않습니다. 저장하기 전에 `$닉네임`·`$방제`
 * 같은 치환자가 어떻게 채워지는지 확인하는 용도이며, 채팅과 **같은 엔진**을
 * 타므로 여기서 본 문장이 실제 응답과 다르지 않습니다.
 */
export function usePreviewCommand() {
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: Partial<ExecuteCommandRequest> & { command: string }) =>
      request<ExecuteCommandResponse>(`/tenants/${tenantId}/commands/execute`, 'POST', {
        args: [],
        broadcast: false,
        dryRun: true,
        ...vars,
      }),
    onError: (error: Error) => toast.error(error.message),
  });
}

// ─── 자동응답 ────────────────────────────────────────────────────────────────

export function useCreateAutoResponse() {
  return useConfigMutation(
    (tenantId, values: Partial<AutoResponse>) =>
      request<AutoResponse>(`/tenants/${tenantId}/auto-responses`, 'POST', values),
    '자동응답을 추가했습니다.'
  );
}

export function useUpdateAutoResponse() {
  return useConfigMutation(
    (tenantId, { id, ...values }: Partial<AutoResponse> & { id: string }) =>
      request<AutoResponse>(`/tenants/${tenantId}/auto-responses/${id}`, 'PUT', values),
    '저장했습니다.'
  );
}

export function useDeleteAutoResponse() {
  return useConfigMutation(
    (tenantId, id: string) => request(`/tenants/${tenantId}/auto-responses/${id}`, 'DELETE'),
    '삭제했습니다.'
  );
}

// ─── 금칙어 ──────────────────────────────────────────────────────────────────

export function useCreateBannedWord() {
  return useConfigMutation(
    (tenantId, values: Partial<BannedWord>) =>
      request<BannedWord>(`/tenants/${tenantId}/banned-words`, 'POST', values),
    '금칙어를 추가했습니다.'
  );
}

export function useUpdateBannedWord() {
  return useConfigMutation(
    (tenantId, { id, ...values }: Partial<BannedWord> & { id: string }) =>
      request<BannedWord>(`/tenants/${tenantId}/banned-words/${id}`, 'PUT', values),
    '저장했습니다.'
  );
}

export function useDeleteBannedWord() {
  return useConfigMutation(
    (tenantId, id: string) => request(`/tenants/${tenantId}/banned-words/${id}`, 'DELETE'),
    '삭제했습니다.'
  );
}

// ─── 주기 메시지 ──────────────────────────────────────────────────────────────

export function useCreateTimer() {
  return useConfigMutation(
    (tenantId, values: Partial<TimerMessage>) =>
      request<TimerMessage>(`/tenants/${tenantId}/timers`, 'POST', values),
    '주기 메시지를 추가했습니다.'
  );
}

export function useUpdateTimer() {
  return useConfigMutation(
    (tenantId, { id, ...values }: Partial<TimerMessage> & { id: string }) =>
      request<TimerMessage>(`/tenants/${tenantId}/timers/${id}`, 'PUT', values),
    '저장했습니다.'
  );
}

export function useDeleteTimer() {
  return useConfigMutation(
    (tenantId, id: string) => request(`/tenants/${tenantId}/timers/${id}`, 'DELETE'),
    '삭제했습니다.'
  );
}

// ─── 봇 제어 ─────────────────────────────────────────────────────────────────

function useBotMutation(fn: (tenantId: string) => Promise<unknown>, message: string) {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: () => fn(tenantId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.status(tenantId) });
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useStartBot() {
  return useBotMutation(
    (tenantId) => request(`/tenants/${tenantId}/bot/start`, 'POST'),
    '봇을 켰습니다.'
  );
}

export function useStopBot() {
  return useBotMutation(
    (tenantId) => request(`/tenants/${tenantId}/bot/stop`, 'POST'),
    '봇을 껐습니다.'
  );
}

/** 대시보드에서 `!입장` / `!퇴장` 과 같은 동작을 시킵니다. */
export function useSetJoined() {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (joined: boolean) => request(`/tenants/${tenantId}/bot/join`, 'POST', { joined }),
    onSuccess: (_data, joined) => {
      void queryClient.invalidateQueries({ queryKey: keys.status(tenantId) });
      toast.success(joined ? '봇을 입장시켰습니다.' : '봇을 퇴장시켰습니다.');
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ─── 시청자 / 포인트 ─────────────────────────────────────────────────────────

export function useUsers() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.viewers(tenantId),
    queryFn: () => request<{ users: UserRecord[]; total: number }>(`/tenants/${tenantId}/viewers`),
    enabled: Boolean(tenantId),
    refetchInterval: 15_000,
    retry: false,
  });
}

function useViewerMutation<TVars>(
  fn: (tenantId: string, vars: TVars) => Promise<unknown>,
  message: string
) {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: TVars) => fn(tenantId, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.viewers(tenantId) });
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useGrantPoints() {
  return useViewerMutation(
    (tenantId, { channelId, delta }: { channelId: string; delta: number }) =>
      request(`/tenants/${tenantId}/viewers/${channelId}/points`, 'POST', { delta }),
    '반영했습니다.'
  );
}

export function useResetPoints() {
  return useViewerMutation(
    (tenantId) => request(`/tenants/${tenantId}/viewers/reset-points`, 'POST'),
    '포인트를 초기화했습니다.'
  );
}

// ─── 신청곡 ──────────────────────────────────────────────────────────────────

export function useSongs() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.songs(tenantId),
    queryFn: () => request<SongsResponse>(`/tenants/${tenantId}/songs`),
    enabled: Boolean(tenantId),
    refetchInterval: 8000,
    retry: false,
  });
}

function useSongMutation<TVars>(
  fn: (tenantId: string, vars: TVars) => Promise<unknown>,
  message: string
) {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: TVars) => fn(tenantId, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.songs(tenantId) });
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useNextSong() {
  return useSongMutation(
    (tenantId) => request(`/tenants/${tenantId}/songs/next`, 'POST'),
    '다음 곡으로 넘겼습니다.'
  );
}

export function useClearSongs() {
  return useSongMutation(
    (tenantId) => request(`/tenants/${tenantId}/songs/clear`, 'POST'),
    '대기열을 비웠습니다.'
  );
}

export function useMoveSong() {
  return useSongMutation(
    (tenantId, { id, direction }: { id: string; direction: 'up' | 'down' }) =>
      request(`/tenants/${tenantId}/songs/${id}/${direction}`, 'POST'),
    '순서를 바꿨습니다.'
  );
}

export function useRemoveSong() {
  return useSongMutation(
    (tenantId, id: string) => request(`/tenants/${tenantId}/songs/${id}`, 'DELETE'),
    '삭제했습니다.'
  );
}

// ─── 이벤트 로그 ─────────────────────────────────────────────────────────────

export function useEvents() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.events(tenantId),
    queryFn: () => request<{ events: LogEntry[]; lastId: number }>(`/tenants/${tenantId}/events`),
    enabled: Boolean(tenantId),
    refetchInterval: 3000,
    retry: false,
  });
}

// ─── 치지직 직접 연동 ────────────────────────────────────────────────────────
//
// 아래 쿼리들은 우리 DB 가 아니라 치지직 서버 상태를 봅니다.
// 스트리머 계정이 아니면 400 "스트리머가 아닙니다" 가 오므로, 화면에서 그대로 안내합니다.

export function useRestrictions() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.restrictions(tenantId),
    queryFn: () =>
      request<{ data: RestrictedChannel[]; next: string | null }>(
        `/tenants/${tenantId}/chzzk/restrictions`
      ),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

function useChzzkMutation<TVars>(
  fn: (tenantId: string, vars: TVars) => Promise<unknown>,
  message: string,
  invalidate: (tenantId: string) => readonly (readonly unknown[])[]
) {
  const queryClient = useQueryClient();
  const tenantId = useTenantId();

  return useMutation({
    mutationFn: (vars: TVars) => fn(tenantId, vars),
    onSuccess: () => {
      for (const key of invalidate(tenantId)) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      toast.success(message);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useUnrestrict() {
  return useChzzkMutation(
    (tenantId, channelId: string) =>
      request(`/tenants/${tenantId}/chzzk/restrictions/${channelId}`, 'DELETE'),
    '활동 제한을 해제했습니다.',
    (tenantId) => [keys.restrictions(tenantId)]
  );
}

export function useRestrict() {
  return useChzzkMutation(
    (tenantId, targetChannelId: string) =>
      request(`/tenants/${tenantId}/chzzk/restrictions`, 'POST', { targetChannelId }),
    '활동을 제한했습니다.',
    (tenantId) => [keys.restrictions(tenantId)]
  );
}

export function useTemporaryUnrestrict() {
  return useChzzkMutation(
    (tenantId, channelId: string) =>
      request(`/tenants/${tenantId}/chzzk/temporary-restrictions/${channelId}`, 'DELETE'),
    '임시 제한을 해제했습니다.',
    (tenantId) => [keys.restrictions(tenantId)]
  );
}

export function useChatSettings() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.chatSettings(tenantId),
    queryFn: () => request<ChatSettings>(`/tenants/${tenantId}/chzzk/chat-settings`),
    enabled: Boolean(tenantId),
    retry: false,
  });
}

export function useSaveChatSettings() {
  return useChzzkMutation(
    (tenantId, values: Partial<ChatSettings>) =>
      request(`/tenants/${tenantId}/chzzk/chat-settings`, 'PUT', values),
    '채팅 설정을 저장했습니다.',
    (tenantId) => [keys.chatSettings(tenantId)]
  );
}

export function useAudience() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.audience(tenantId),
    queryFn: () => request<AudienceResponse>(`/tenants/${tenantId}/chzzk/audience`),
    enabled: Boolean(tenantId),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useManagers() {
  const tenantId = useTenantId();

  return useQuery({
    queryKey: keys.managers(tenantId),
    queryFn: () => request<{ data: StreamingRole[] }>(`/tenants/${tenantId}/chzzk/managers`),
    enabled: Boolean(tenantId),
    retry: false,
  });
}
