import type { Logger } from './logger.js';

export interface RequestLogFields {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string | undefined;
  userId?: string | undefined;
  tenantId?: string | undefined;
}

/**
 * HTTP 요청 한 줄 로그.
 *
 * 사람이 읽는 문장 뒤에 구조화된 필드를 붙입니다. 개발 중에는 터미널에서 바로
 * 읽히고, 배포 환경에서는 뒤쪽 JSON 만 파싱하면 그대로 지표가 됩니다.
 * 4xx 는 warn, 5xx 는 error 로 올려 로그 레벨만 보고도 장애를 걸러낼 수 있게 합니다.
 */
export function createRequestLogger(logger: Logger) {
  const log = logger.child('http');

  return (fields: RequestLogFields): void => {
    const line = `${fields.method} ${fields.path} ${fields.status} ${fields.durationMs}ms`;
    const context = JSON.stringify({
      requestId: fields.requestId,
      userId: fields.userId,
      tenantId: fields.tenantId,
    });

    if (fields.status >= 500) log.error(line, context);
    else if (fields.status >= 400) log.warn(line, context);
    else log.info(line, context);
  };
}
