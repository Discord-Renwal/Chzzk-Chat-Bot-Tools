import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { Paged, RestrictedChannel } from './types.js';

/**
 * 활동 제한(밴) API. 모두 사용자 액세스 토큰이 필요합니다.
 *
 * - 영구 제한: `/open/v1/restrict-channels` — 스코프 활동제한 쓰기 / 활동제한 조회
 * - 임시 제한: `/open/v1/temporary-restrict-channels` — 채팅 채널 단위의 일시 제한
 */
export class RestrictionsApi {
  constructor(private readonly http: HttpClient) {}

  /** 활동 제한 추가 */
  async restrict(targetChannelId: string): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: '/open/v1/restrict-channels',
      auth: 'user',
      body: { targetChannelId },
    });
  }

  /** 활동 제한 해제 */
  async unrestrict(targetChannelId: string): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: '/open/v1/restrict-channels',
      auth: 'user',
      body: { targetChannelId },
    });
  }

  /** 활동 제한 목록 조회. size 최대 30, 기본 30 */
  async list(params: { size?: number; next?: string } = {}): Promise<Paged<RestrictedChannel>> {
    if (params.size !== undefined && (params.size < 1 || params.size > 30)) {
      throw new ChzzkValidationError(
        `size 는 1 이상 30 이하여야 합니다 (받은 값: ${params.size}).`
      );
    }
    return this.http.request<Paged<RestrictedChannel>>({
      method: 'GET',
      path: '/open/v1/restrict-channels',
      auth: 'user',
      query: { size: params.size, next: params.next },
    });
  }

  /**
   * 임시 제한 추가. `chatChannelId` 는 CHAT 이벤트 페이로드에서 얻습니다.
   * 존재하지 않거나 이미 임시제한된 사용자면 400 을 반환합니다.
   */
  async temporaryRestrict(input: {
    targetChannelId: string;
    chatChannelId: string;
  }): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: '/open/v1/temporary-restrict-channels',
      auth: 'user',
      body: input,
    });
  }

  /** 임시 제한 해제 */
  async temporaryUnrestrict(input: {
    targetChannelId: string;
    chatChannelId: string;
  }): Promise<void> {
    await this.http.request<void>({
      method: 'DELETE',
      path: '/open/v1/temporary-restrict-channels',
      auth: 'user',
      body: input,
    });
  }
}
