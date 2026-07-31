import type { ErrorCode } from '@chzzk-bot/contracts';

/**
 * 모든 API 호출이 지나는 한 지점.
 *
 * 서버가 항상 `{ error: { code, message } }` 로 실패를 알려주므로, 여기서 한 번만
 * 풀어내면 화면은 `error.message` 를 그대로 보여주면 됩니다. 화면마다 응답을
 * 다르게 파싱하면 결국 전부 "알 수 없는 오류" 로 뭉개집니다.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** 로그인이 풀렸는지 (화면이 로그인 페이지로 보낼지 판단) */
  get isUnauthorized(): boolean {
    return this.code === 'UNAUTHORIZED';
  }

  /** 요금제 때문에 막혔는지 (업그레이드 안내를 띄울지 판단) */
  get needsUpgrade(): boolean {
    return this.code === 'PLAN_LIMIT_EXCEEDED' || this.code === 'SUBSCRIPTION_REQUIRED';
  }
}

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`/api${path}`, {
      method,
      // 세션 쿠키를 보내야 합니다. 기본값(same-origin)으로도 되지만, 프런트를
      // 다른 도메인에 올렸을 때 조용히 로그인이 풀리는 걸 막으려고 명시합니다.
      credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.', 0, 'NETWORK');
  }

  // 204 처럼 본문이 없는 응답도 있습니다.
  const text = await response.text();
  const data: unknown = text ? safeParse(text) : {};

  if (!response.ok) {
    const envelope = data as {
      error?: { code?: ErrorCode; message?: string; fields?: Record<string, string> };
    };
    throw new ApiError(
      envelope.error?.message ?? `${response.status} 오류가 발생했습니다.`,
      response.status,
      envelope.error?.code ?? 'INTERNAL',
      envelope.error?.fields
    );
  }

  return data as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
