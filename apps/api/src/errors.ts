import { ERROR_STATUS, type ErrorCode } from '@chzzk-bot/contracts';
import { ChzzkApiError } from '@chzzk-bot/chzzk-sdk';
import type { ZodError } from 'zod';

/**
 * API 가 던지는 유일한 오류 타입.
 *
 * 라우트에서 `reply.code(400).send({error: '...'})` 를 손으로 쓰지 않는 게
 * 규칙입니다. 그렇게 하면 어떤 곳은 `{error: "문장"}`, 어떤 곳은 `{message}` 를
 * 주게 되고, 프런트는 결국 전부 "알 수 없는 오류" 로 뭉갭니다.
 */
export class ApiException extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    status?: number
  ) {
    super(message);
    this.name = 'ApiException';
    this.status = status ?? ERROR_STATUS[code];
  }

  static badRequest(message: string, fields?: Record<string, string>): ApiException {
    return new ApiException('BAD_REQUEST', message, fields);
  }

  static unauthorized(message = '로그인이 필요합니다.'): ApiException {
    return new ApiException('UNAUTHORIZED', message);
  }

  static forbidden(message = '이 작업을 수행할 권한이 없습니다.'): ApiException {
    return new ApiException('FORBIDDEN', message);
  }

  static notFound(message = '찾을 수 없습니다.'): ApiException {
    return new ApiException('NOT_FOUND', message);
  }

  static conflict(message: string): ApiException {
    return new ApiException('CONFLICT', message);
  }

  static planLimit(message: string): ApiException {
    return new ApiException('PLAN_LIMIT_EXCEEDED', message);
  }

  static subscriptionRequired(
    message = '구독이 만료되었습니다. 요금제를 확인해 주세요.'
  ): ApiException {
    return new ApiException('SUBSCRIPTION_REQUIRED', message);
  }

  /** 치지직·PG 같은 외부 서비스가 준 오류를 그대로 전달할 때 */
  static upstream(message: string, status?: number): ApiException {
    return new ApiException('UPSTREAM_ERROR', message, undefined, status);
  }
}

/** zod 검증 실패를 필드별 메시지로 바꿉니다. */
export function fromZodError(error: ZodError): ApiException {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    fields[issue.path.join('.') || '값'] = issue.message;
  }
  const summary = Object.entries(fields)
    .map(([key, message]) => `${key}: ${message}`)
    .join(', ');

  return ApiException.badRequest(summary || '입력값이 올바르지 않습니다.', fields);
}

/**
 * 치지직 오류를 사용자에게 보여줄 문장으로 바꿉니다.
 *
 * 상태 코드를 그대로 전달하는 게 중요합니다. 스트리머 계정이 아니면 치지직이
 * 400 을 주는데, 이걸 500 으로 뭉개면 화면은 "서버 오류" 라고만 말하고 사용자는
 * 자기가 무엇을 해야 하는지 알 수 없습니다.
 */
export function fromChzzkError(error: unknown): ApiException {
  if (error instanceof ChzzkApiError) {
    // "[400] GET /path — 스트리머가 아닙니다." 에서 뒷부분만 남깁니다.
    const message = error.message.split('—').pop()?.trim() ?? error.message;
    return ApiException.upstream(message, error.status || 400);
  }
  return ApiException.upstream(error instanceof Error ? error.message : String(error));
}
