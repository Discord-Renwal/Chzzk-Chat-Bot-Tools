import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { CategoryType, LiveSetting, LiveSummary, Paged, StreamKey } from './types.js';

export interface UpdateLiveSettingInput {
  /** 라이브 제목. 빈 문자열로는 설정할 수 없습니다. */
  defaultLiveTitle?: string;
  categoryType?: CategoryType;
  /** 빈 문자열을 보내면 카테고리가 해제됩니다. */
  categoryId?: string;
  /** 공백과 특수문자는 허용되지 않습니다. 빈 배열을 보내면 태그가 모두 지워집니다. */
  tags?: string[];
}

export class LivesApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /open/v1/lives — 진행 중인 라이브 목록 (클라이언트 인증).
   * 시청자 수가 많은 순으로 정렬되며 size 는 1~20 입니다.
   */
  async list(
    params: { size?: number | undefined; next?: string | undefined } = {}
  ): Promise<Paged<LiveSummary>> {
    if (params.size !== undefined && (params.size < 1 || params.size > 20)) {
      throw new ChzzkValidationError(
        `size 는 1 이상 20 이하여야 합니다 (받은 값: ${params.size}).`
      );
    }
    return this.http.request<Paged<LiveSummary>>({
      method: 'GET',
      path: '/open/v1/lives',
      auth: 'client',
      query: { size: params.size, next: params.next },
    });
  }

  /** 커서를 따라가며 라이브 목록 전체를 순회합니다. */
  async *iterate(pageSize = 20): AsyncGenerator<LiveSummary> {
    let next: string | undefined;
    do {
      const page = await this.list({ size: pageSize, next });
      yield* page.data;
      next = page.page?.next ?? undefined;
    } while (next);
  }

  /** GET /open/v1/lives/setting — 스코프: 방송 설정 조회 */
  async getSetting(): Promise<LiveSetting> {
    return this.http.request<LiveSetting>({
      method: 'GET',
      path: '/open/v1/lives/setting',
      auth: 'user',
    });
  }

  /** PATCH /open/v1/lives/setting — 스코프: 방송 설정 변경 */
  async updateSetting(input: UpdateLiveSettingInput): Promise<void> {
    if (input.defaultLiveTitle !== undefined && input.defaultLiveTitle.trim() === '') {
      throw new ChzzkValidationError('defaultLiveTitle 은 빈 값으로 설정할 수 없습니다.');
    }
    await this.http.request<void>({
      method: 'PATCH',
      path: '/open/v1/lives/setting',
      auth: 'user',
      body: input,
    });
  }

  /**
   * GET /open/v1/streams/key — 스코프: 방송 스트림키 조회
   *
   * 스트림키는 방송 송출 권한 그 자체입니다. 로그로 남기지 마세요.
   */
  async getStreamKey(): Promise<StreamKey> {
    return this.http.request<StreamKey>({
      method: 'GET',
      path: '/open/v1/streams/key',
      auth: 'user',
    });
  }
}
