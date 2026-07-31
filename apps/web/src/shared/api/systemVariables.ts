import { useQuery } from '@tanstack/react-query';
import type { SystemVariable, SystemVariableGroup } from '@chzzk-bot/contracts';
import { request } from './client';

export interface SystemVariablesResponse {
  variables: SystemVariable[];
  groupLabels: Record<SystemVariableGroup, string>;
}

/**
 * 시스템 변수 목록 — 서버가 소유합니다.
 *
 * 프런트에 하드코딩하지 않는 이유는, 화면이 안내하는 변수와 엔진이 해석하는
 * 변수가 갈라지면 사용자가 방송 중에 `$없는변수` 를 그대로 보게 되기 때문입니다.
 *
 * 배포 전까지 바뀌지 않는 값이라 한 번 받아 계속 씁니다.
 */
export function useSystemVariables() {
  return useQuery({
    queryKey: ['system-variables'] as const,
    queryFn: () => request<SystemVariablesResponse>('/system/variables'),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * 입력칸 아래에 짧게 붙이는 힌트용 — 자주 쓰는 것만 추립니다.
 *
 * 전부 나열하면 20개가 넘어 폼이 안내문에 파묻힙니다. 전체 목록은
 * 사이드바의 "시스템 변수" 화면에 있습니다.
 */
export function useCommonVariables(limit = 5): SystemVariable[] {
  const { data } = useSystemVariables();
  if (!data) return [];

  const preferred = ['닉네임', '값', '개수', '카운트', '변수'];
  const byName = new Map(data.variables.map((variable) => [variable.name, variable]));

  return preferred
    .map((name) => byName.get(name))
    .filter((variable): variable is SystemVariable => variable !== undefined)
    .slice(0, limit);
}
