import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../src/core/http.js';
import { ChzzkApiError } from '../src/core/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeClient(overrides: Partial<ConstructorParameters<typeof HttpClient>[0]> = {}) {
  return new HttpClient({
    clientId: 'test-id',
    clientSecret: 'test-secret',
    maxRetries: 0,
    ...overrides,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpClient', () => {
  it('성공 응답에서 content 를 꺼낸다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 200, message: null, content: { channelId: 'abc' } })
    );

    const result = await makeClient().request<{ channelId: string }>({
      method: 'GET',
      path: '/open/v1/users/me',
      auth: 'client',
    });

    expect(result).toEqual({ channelId: 'abc' });
  });

  it('클라이언트 인증은 Client-Id / Client-Secret 헤더를 보낸다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 200, message: null, content: { data: [] } }));

    await makeClient().request({ method: 'GET', path: '/open/v1/lives', auth: 'client' });

    const headers = (fetchSpy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Client-Id']).toBe('test-id');
    expect(headers['Client-Secret']).toBe('test-secret');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('유저 인증은 "Bearer " 접두사와 공백을 지킨다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 200, message: null, content: {} }));

    await makeClient({
      tokenProvider: { getAccessToken: async () => 'TOKEN123' },
    }).request({ method: 'GET', path: '/open/v1/users/me', auth: 'user' });

    const headers = (fetchSpy.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer TOKEN123');
  });

  it('배열 쿼리는 키를 반복해 직렬화한다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 200, message: null, content: { data: [] } }));

    await makeClient().request({
      method: 'GET',
      path: '/open/v1/channels',
      auth: 'client',
      query: { channelIds: ['a', 'b'] },
    });

    const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(url.searchParams.getAll('channelIds')).toEqual(['a', 'b']);
  });

  it('실패 봉투를 ChzzkApiError 로 바꾼다', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ code: 401, message: 'INVALID_TOKEN' }, 401)
    );

    const error = await makeClient()
      .request({ method: 'GET', path: '/open/v1/users/me', auth: 'client' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ChzzkApiError);
    expect((error as ChzzkApiError).code).toBe(401);
    expect((error as ChzzkApiError).isUnauthorized).toBe(true);
  });

  it('401 을 만나면 토큰을 한 번 갱신하고 재시도한다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 401, message: 'INVALID_TOKEN' }, 401))
      .mockResolvedValueOnce(jsonResponse({ code: 200, message: null, content: { ok: true } }));

    let token = 'old';
    const result = await makeClient({
      tokenProvider: {
        getAccessToken: async () => token,
        refreshAccessToken: async () => {
          token = 'new';
          return token;
        },
      },
    }).request({ method: 'GET', path: '/open/v1/users/me', auth: 'user' });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const second = (fetchSpy.mock.calls[1]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(second['Authorization']).toBe('Bearer new');
  });

  it('갱신 수단이 없으면 401 을 그대로 던진다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ code: 401, message: 'INVALID_TOKEN' }, 401));

    await expect(
      makeClient({ tokenProvider: { getAccessToken: async () => 'tok' } }).request({
        method: 'GET',
        path: '/open/v1/users/me',
        auth: 'user',
      })
    ).rejects.toBeInstanceOf(ChzzkApiError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('429 는 재시도한다', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ code: 429, message: 'TOO_MANY_REQUESTS' }, 429))
      .mockResolvedValueOnce(jsonResponse({ code: 200, message: null, content: { ok: true } }));

    const result = await makeClient({ maxRetries: 1 }).request({
      method: 'GET',
      path: '/open/v1/lives',
      auth: 'client',
    });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
