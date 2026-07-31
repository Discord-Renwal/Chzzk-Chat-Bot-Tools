import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type { Channel, Follower, StreamingRole, Subscriber, SubscriberSort } from './types.js';

/** GET /open/v1/channels 는 한 번에 최대 20개 채널까지 조회할 수 있습니다. */
export const MAX_CHANNEL_IDS = 20;

export class ChannelsApi {
  constructor(private readonly http: HttpClient) {}

  /**
   * 채널 정보 조회 (클라이언트 인증). 최대 20개까지 한 번에 요청할 수 있어,
   * 그보다 많으면 20개씩 잘라 순차 호출합니다.
   */
  async getMany(channelIds: string[]): Promise<Channel[]> {
    if (channelIds.length === 0) return [];

    const results: Channel[] = [];
    for (let i = 0; i < channelIds.length; i += MAX_CHANNEL_IDS) {
      const batch = channelIds.slice(i, i + MAX_CHANNEL_IDS);
      const res = await this.http.request<{ data: Channel[] }>({
        method: 'GET',
        path: '/open/v1/channels',
        auth: 'client',
        query: { channelIds: batch },
      });
      results.push(...res.data);
    }
    return results;
  }

  /** 단일 채널 조회. 없으면 null */
  async get(channelId: string): Promise<Channel | null> {
    const [found] = await this.getMany([channelId]);
    return found ?? null;
  }

  /** GET /open/v1/channels/streaming-roles — 내가 매니저로 참여 중인 채널 목록 */
  async streamingRoles(): Promise<StreamingRole[]> {
    const res = await this.http.request<{ data: StreamingRole[] }>({
      method: 'GET',
      path: '/open/v1/channels/streaming-roles',
      auth: 'user',
    });
    return res.data;
  }

  /** GET /open/v1/channels/followers — size 는 1~50, 기본 30 */
  async followers(params: { page?: number; size?: number } = {}): Promise<Follower[]> {
    assertPageSize(params.size, 50);
    const res = await this.http.request<{ data: Follower[] }>({
      method: 'GET',
      path: '/open/v1/channels/followers',
      auth: 'user',
      query: { page: params.page, size: params.size },
    });
    return res.data;
  }

  /** GET /open/v1/channels/subscribers — size 는 1~50, 기본 30 */
  async subscribers(
    params: { page?: number; size?: number; sort?: SubscriberSort } = {}
  ): Promise<Subscriber[]> {
    assertPageSize(params.size, 50);
    const res = await this.http.request<{ data: Subscriber[] }>({
      method: 'GET',
      path: '/open/v1/channels/subscribers',
      auth: 'user',
      query: { page: params.page, size: params.size, sort: params.sort },
    });
    return res.data;
  }
}

function assertPageSize(size: number | undefined, max: number): void {
  if (size === undefined) return;
  if (size < 1 || size > max) {
    throw new ChzzkValidationError(`size 는 1 이상 ${max} 이하여야 합니다 (받은 값: ${size}).`);
  }
}
