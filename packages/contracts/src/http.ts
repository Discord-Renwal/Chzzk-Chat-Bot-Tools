import { z } from 'zod';

/**
 * HTTP 계층의 공통 모양.
 *
 * 오류 응답은 **항상** `{ error: { code, message } }` 입니다. 예전 대시보드처럼
 * 어떤 곳은 `{ error: "문장" }`, 어떤 곳은 `{ message }` 를 주면 프런트가
 * 매번 다르게 파싱해야 하고 결국 "알 수 없는 오류" 로 뭉개집니다.
 */

export const errorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'PLAN_LIMIT_EXCEEDED',
  'SUBSCRIPTION_REQUIRED',
  'UPSTREAM_ERROR',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof errorCode>;

/** 코드별 기본 HTTP 상태. 라우트가 따로 정하지 않으면 이 표를 씁니다. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  PLAN_LIMIT_EXCEEDED: 402,
  SUBSCRIPTION_REQUIRED: 402,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export const apiError = z.object({
  error: z.object({
    code: errorCode,
    /** 사용자에게 그대로 보여줘도 되는 한국어 문장 */
    message: z.string(),
    /** 필드 단위 검증 실패 상세 */
    fields: z.record(z.string(), z.string()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiError>;

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.infer<typeof pageQuery>;

export interface Paginated<T> {
  data: T[];
  page: number;
  size: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(data: T[], total: number, query: PageQuery): Paginated<T> {
  return {
    data,
    page: query.page,
    size: query.size,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.size)),
  };
}
