import type { HttpClient } from '../core/http.js';
import type { Me } from './types.js';

export class UsersApi {
  constructor(private readonly http: HttpClient) {}

  /** GET /open/v1/users/me — 스코프: 유저 정보 조회 */
  async me(): Promise<Me> {
    return this.http.request<Me>({
      method: 'GET',
      path: '/open/v1/users/me',
      auth: 'user',
    });
  }
}
