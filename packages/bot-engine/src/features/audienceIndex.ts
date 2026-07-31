import type { ChzzkClient } from '@chzzk-bot/chzzk-sdk';
import type { Subscriber } from '@chzzk-bot/chzzk-sdk';
import { noopLogger, type Logger } from '@chzzk-bot/logger';

/**
 * 구독자 · 팔로워 수 캐시.
 *
 * 왜 필요한가: 치지직의 CHAT 이벤트에는 구독 여부가 들어오지 않습니다.
 * `userRoleCode` 는 스트리머/매니저/일반 시청자만 구분하고 구독자라는 값이 없어서,
 * "구독자 전용 명령" 을 만들려면 구독자 목록을 따로 받아 대조하는 수밖에 없습니다.
 *
 * 목록은 주기적으로만 갱신합니다 — 채팅마다 API 를 부르면 분당 쿼터를 태웁니다.
 * 즉 방금 구독한 사람이 최대 갱신 주기만큼 늦게 인식될 수 있습니다.
 */
export class AudienceIndex {
  private subscriberIds = new Set<string>();
  private subscriberDetail = new Map<string, Subscriber>();
  private followerCount = 0;
  private lastSyncedAt = 0;
  private syncing: Promise<void> | undefined;
  private readonly log: Logger;

  /** 스트리머 계정이 아니면 조회가 막히므로, 한 번 실패하면 조용히 비활성화합니다. */
  private unavailable = false;

  constructor(
    private readonly chzzk: ChzzkClient,
    private readonly myChannelId: string,
    private readonly intervalMs = 10 * 60_000,
    logger?: Logger
  ) {
    this.log = (logger ?? noopLogger).child('audience');
  }

  get isSubscriberDataAvailable(): boolean {
    return !this.unavailable;
  }

  get followers(): number {
    return this.followerCount;
  }

  get subscriberCount(): number {
    return this.subscriberIds.size;
  }

  isSubscriber(channelId: string): boolean {
    return this.subscriberIds.has(channelId);
  }

  subscriberOf(channelId: string): Subscriber | undefined {
    return this.subscriberDetail.get(channelId);
  }

  /**
   * SUBSCRIPTION 이벤트가 오면 즉시 반영합니다.
   *
   * 목록 갱신 주기(기본 10분)를 기다리면, 방금 구독한 사람이 구독자 전용 명령을
   * 썼을 때 "구독자가 아니다" 라고 답하게 됩니다. 가장 티가 나는 순간이라
   * 이벤트로 들어온 정보는 바로 넣어 둡니다.
   */
  noteSubscription(subscriber: {
    channelId: string;
    nickname: string;
    month: number;
    tierNo: number;
  }): void {
    this.subscriberIds.add(subscriber.channelId);
    this.subscriberDetail.set(subscriber.channelId, {
      channelId: subscriber.channelId,
      channelName: subscriber.nickname,
      month: subscriber.month,
      tierNo: subscriber.tierNo,
      createdDate: new Date().toISOString(),
    });
  }

  /** 필요하면 갱신합니다. 실패해도 이전 값을 계속 씁니다. */
  async refresh(force = false): Promise<void> {
    if (this.unavailable && !force) return;
    if (!force && Date.now() - this.lastSyncedAt < this.intervalMs) return;

    this.syncing ??= this.sync().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }

  private async sync(): Promise<void> {
    this.lastSyncedAt = Date.now();

    // 팔로워 수는 채널 정보로 한 번에 얻습니다. 목록 전체를 받을 필요가 없습니다.
    try {
      const channel = await this.chzzk.channels.get(this.myChannelId);
      if (channel) this.followerCount = channel.followerCount;
    } catch (error) {
      this.log.debug('채널 정보를 가져오지 못했습니다.', error);
    }

    // 구독자는 페이지를 넘겨 가며 모읍니다. 상한을 둬서 쿼터를 지킵니다.
    try {
      const collected = new Map<string, Subscriber>();
      const MAX_PAGES = 10; // 최대 500명
      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await this.chzzk.channels.subscribers({ page, size: 50, sort: 'RECENT' });
        for (const subscriber of batch) collected.set(subscriber.channelId, subscriber);
        if (batch.length < 50) break;
      }

      this.subscriberDetail = collected;
      this.subscriberIds = new Set(collected.keys());
      this.unavailable = false;
      this.log.debug(`구독자 ${collected.size}명, 팔로워 ${this.followerCount}명`);
    } catch (error) {
      // 스트리머 계정이 아니면 400 이 납니다. 매번 재시도해봐야 소용없습니다.
      this.unavailable = true;
      this.log.debug(
        '구독자 목록을 가져오지 못했습니다. 구독자 전용 기능은 비활성화됩니다.',
        error
      );
    }
  }
}
