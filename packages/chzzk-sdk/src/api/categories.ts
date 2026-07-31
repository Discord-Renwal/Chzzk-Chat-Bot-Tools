import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { Category } from './types.js';

export class CategoriesApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * GET /open/v1/categories/search — 카테고리 이름 검색 (클라이언트 인증).
   * size 는 1~50, 기본 20 입니다.
   */
  async search(query: string, params: { size?: number } = {}): Promise<Category[]> {
    if (query.trim() === '') {
      throw new ChzzkValidationError('query 는 필수입니다.');
    }
    if (params.size !== undefined && (params.size < 1 || params.size > 50)) {
      throw new ChzzkValidationError(
        `size 는 1 이상 50 이하여야 합니다 (받은 값: ${params.size}).`
      );
    }
    const res = await this.http.request<{ data: Category[] }>({
      method: 'GET',
      path: '/open/v1/categories/search',
      auth: 'client',
      query: { query, size: params.size },
    });
    return res.data;
  }
}
