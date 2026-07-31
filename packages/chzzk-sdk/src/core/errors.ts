/**
 * CHZZK Open API 가 반환한 실패 응답을 표현합니다.
 *
 * 문서상 실패 응답은 `{ "code": integer, "message": string }` 형태이며
 * 성공 시에만 `content` 가 함께 옵니다.
 */
export class ChzzkApiError extends Error {
  readonly code: number;
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(init: {
    code: number;
    status: number;
    method: string;
    path: string;
    message: string;
    body?: unknown;
  }) {
    super(`[${init.code}] ${init.method} ${init.path} — ${init.message}`);
    this.name = 'ChzzkApiError';
    this.code = init.code;
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.body = init.body;
  }

  /** 401 UNAUTHORIZED / INVALID_TOKEN — 액세스 토큰 갱신이 필요한 상태인지 여부 */
  get isUnauthorized(): boolean {
    return this.code === 401 || this.status === 401;
  }

  /** 429 TOO_MANY_REQUESTS — 호출 쿼터 초과 */
  get isRateLimited(): boolean {
    return this.code === 429 || this.status === 429;
  }
}

/** 네트워크 실패, 타임아웃 등 응답을 받기 전에 끊긴 경우 */
export class ChzzkTransportError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ChzzkTransportError';
  }
}

/** 로컬에서 사전 검증 가능한 규칙(길이 제한, 허용값 등)을 어겼을 때 */
export class ChzzkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChzzkValidationError';
  }
}
