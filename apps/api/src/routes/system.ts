import type { FastifyInstance } from 'fastify';
import { SYSTEM_VARIABLES, SYSTEM_VARIABLE_GROUP_LABELS } from '@chzzk-bot/contracts';

/**
 * 서버가 소유하는 참조 데이터.
 *
 * 시스템 변수는 사용자가 만들 수 없습니다 — 엔진이 해석할 수 있는 것만
 * 존재하고, 목록은 배포와 함께 바뀝니다. 그래서 프런트에 하드코딩하지 않고
 * 여기서 내려줍니다. 화면이 안내하는 변수는 항상 실제로 동작합니다.
 */
export function registerSystemRoutes(app: FastifyInstance): void {
  app.get('/system/variables', (_request, reply) => {
    // 배포 전까지 바뀌지 않는 값이라 캐시를 길게 잡습니다.
    void reply.header('Cache-Control', 'public, max-age=3600');

    return {
      variables: SYSTEM_VARIABLES,
      groupLabels: SYSTEM_VARIABLE_GROUP_LABELS,
    };
  });
}
