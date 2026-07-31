import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { CursorPage, DropRewardClaim, DropUpdateResult, FulfillmentState } from './types.js';

export interface ListRewardClaimsParams {
  /** 페이징 첫 기준 식별자 (이전 응답의 `page.cursor`) */
  from?: string;
  /** 기본 20 */
  size?: number;
  /** 최대 100개 */
  claimIds?: string[];
  channelId?: string;
  /** campaignId 와 categoryId 는 동시에 사용할 수 없습니다. */
  campaignId?: string;
  categoryId?: string;
  fulfillmentState?: FulfillmentState;
}

/**
 * Drops API. 개발자센터에서 사업자 인증 + Drops 스코프를 받은 애플리케이션만 사용할 수 있습니다.
 */
export class DropsApi {
  constructor(private readonly http: HttpClient) {}

  async listRewardClaims(
    params: ListRewardClaimsParams = {}
  ): Promise<{ data: DropRewardClaim[]; page: CursorPage }> {
    if (params.campaignId && params.categoryId) {
      throw new ChzzkValidationError('campaignId 와 categoryId 는 동시에 사용할 수 없습니다.');
    }
    if (params.claimIds && params.claimIds.length > 100) {
      throw new ChzzkValidationError(
        `claimIds 는 최대 100개입니다 (받은 값: ${params.claimIds.length}개).`
      );
    }

    return this.http.request<{ data: DropRewardClaim[]; page: CursorPage }>({
      method: 'GET',
      path: '/open/v1/drops/reward-claims',
      auth: 'client',
      query: {
        'page.from': params.from,
        'page.size': params.size,
        // 문서상 claimId 는 콤마로 구분된 배열입니다.
        claimId: params.claimIds?.join(','),
        channelId: params.channelId,
        campaignId: params.campaignId,
        categoryId: params.categoryId,
        fulfillmentState: params.fulfillmentState,
      },
    });
  }

  /** 보상 지급 상태 갱신 */
  async updateRewardClaims(input: {
    claimIds: string[];
    fulfillmentState: FulfillmentState;
  }): Promise<DropUpdateResult[]> {
    const res = await this.http.request<{ data: DropUpdateResult[] }>({
      method: 'PUT',
      path: '/open/v1/drops/reward-claims',
      auth: 'client',
      body: input,
    });
    return res.data;
  }
}
