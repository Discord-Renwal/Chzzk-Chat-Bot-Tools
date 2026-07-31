import {
  starterConfig,
  SYSTEM_VARIABLES,
  SYSTEM_VARIABLE_GROUP_LABELS,
  type BotConfig,
} from '@chzzk-bot/contracts';

/**
 * 백엔드 없이 화면을 보기 위한 개발용 목(mock).
 *
 * `VITE_MOCK_API=1 pnpm dev:web` 일 때만 `window.fetch` 를 가로챕니다.
 * 프로덕션 번들에는 들어가지 않습니다 — `import.meta.env.DEV` 로 한 번 더 막고,
 * 호출부가 동적 import 라 트리셰이킹으로도 떨어집니다.
 *
 * 목을 두는 이유는 **UI 를 고칠 때마다 Postgres 와 치지직 계정이 필요하지 않게**
 * 하기 위해서입니다. 다만 목이 실물과 어긋나면 그게 더 나쁘므로, 응답은 전부
 * `@chzzk-bot/contracts` 의 타입으로 선언해 계약이 바뀌면 여기서 먼저 깨지게 합니다.
 *
 * 데이터는 일부러 "적당히 지저분하게" 넣었습니다. 빈 목록과 완벽한 데이터만으로
 * 디자인하면 긴 닉네임, 실패한 결제, 오류 상태 같은 실제 화면을 놓칩니다.
 */

const TENANT_ID = 'tnt_demo';
const HOUR = 3600_000;

function ago(ms: number): number {
  return Date.now() - ms;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** 예시 설정에 실제 채널처럼 보이는 항목을 얹습니다. */
function mockConfig(): BotConfig {
  const base = starterConfig();

  return {
    ...base,
    general: { ...base.general, enabled: true },
    points: { ...base.points, unitName: '젤리' },
    games: { ...base.games, enabled: true },
    songs: { ...base.songs, enabled: true, cost: 100 },
    commands: [
      ...base.commands,
      {
        id: 'cmd_death',
        name: '데스',
        aliases: ['death', '죽음'],
        type: 'counter',
        response: '오늘 {count}번째 사망입니다...',
        items: [],
        count: 17,
        useRoles: [
          'streamer',
          'streaming_channel_manager',
          'streaming_chat_manager',
          'common_user',
        ],
        editRoles: ['streamer', 'streaming_channel_manager'],
        subscriberOnly: false,
        cooldownSec: 3,
        enabled: true,
        usedCount: 342,
      },
      {
        id: 'cmd_setting',
        name: '사양',
        aliases: ['스펙', 'spec'],
        type: 'text',
        response: 'CPU 7800X3D / GPU 4070Ti / RAM 32GB',
        items: [],
        count: 0,
        useRoles: [
          'streamer',
          'streaming_channel_manager',
          'streaming_chat_manager',
          'common_user',
        ],
        editRoles: ['streamer', 'streaming_channel_manager'],
        subscriberOnly: false,
        cooldownSec: 10,
        enabled: true,
        usedCount: 88,
      },
      {
        id: 'cmd_sub',
        name: '구독혜택',
        aliases: [],
        type: 'text',
        response: '구독자 전용 이모티콘과 !인사 명령을 쓸 수 있어요!',
        items: [],
        count: 0,
        useRoles: [
          'streamer',
          'streaming_channel_manager',
          'streaming_chat_manager',
          'common_user',
        ],
        editRoles: ['streamer', 'streaming_channel_manager'],
        subscriberOnly: true,
        cooldownSec: 30,
        enabled: false,
        usedCount: 5,
      },
      {
        // 시청자 목록에는 안 나오고 "관리자 명령어" 쪽에만 뜹니다.
        id: 'cmd_notice',
        name: '공지',
        aliases: ['notice'],
        type: 'text',
        response: '📢 $변수',
        items: [],
        count: 0,
        useRoles: ['streamer', 'streaming_channel_manager', 'streaming_chat_manager'],
        editRoles: ['streamer', 'streaming_channel_manager'],
        subscriberOnly: false,
        cooldownSec: 0,
        enabled: true,
        usedCount: 12,
      },
      {
        id: 'cmd_clear',
        name: '슬로우',
        aliases: [],
        type: 'text',
        response: '채팅 속도를 잠시 늦춥니다.',
        items: [],
        count: 0,
        useRoles: ['streamer', 'streaming_channel_manager'],
        editRoles: ['streamer'],
        subscriberOnly: false,
        cooldownSec: 0,
        enabled: false,
        usedCount: 2,
      },
    ],
    autoResponses: [
      ...base.autoResponses,
      {
        id: 'ar_gg',
        label: '패배 위로',
        pattern: '^(ㅜㅜ|ㅠㅠ)$',
        mode: 'regex',
        caseSensitive: false,
        response: '괜찮아요, 다음 판이 있잖아요!',
        cooldownSec: 60,
        chancePercent: 40,
        enabled: true,
      },
    ],
    timers: [
      {
        id: 'tm_discord',
        label: '디스코드 홍보',
        message: '디스코드에서 같이 놀아요 → !디스코드',
        intervalMinutes: 30,
        minChatsSinceLast: 20,
        enabled: true,
      },
      {
        id: 'tm_follow',
        label: '팔로우 유도',
        message: '재밌으셨다면 팔로우 부탁드려요!',
        intervalMinutes: 45,
        minChatsSinceLast: 30,
        enabled: false,
      },
    ],
    moderation: {
      ...base.moderation,
      allowTempBan: true,
      spam: { ...base.moderation.spam, enabled: true, maxRepeatedChars: 12, blockLinks: true },
      words: [
        {
          id: 'bw_1',
          pattern: '광고',
          mode: 'contains',
          caseSensitive: false,
          action: 'blindAndWarn',
          warnMessage: '광고성 메시지는 삼가 주세요.',
          enabled: true,
          hitCount: 23,
        },
        {
          id: 'bw_2',
          pattern: 'https?://(?!chzzk\\.naver\\.com)',
          mode: 'regex',
          caseSensitive: false,
          action: 'blindAndTempBan',
          warnMessage: '',
          enabled: true,
          hitCount: 7,
        },
      ],
    },
  };
}

/** 경로별 고정 응답. 함수로 두어 매번 최신 시각을 만듭니다. */
function routes(): { pattern: RegExp; body: () => unknown }[] {
  const t = `/api/tenants/${TENANT_ID}`;

  return [
    {
      pattern: /^\/api\/auth\/me$/,
      body: () => ({
        user: {
          id: 'usr_demo',
          chzzkChannelId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
          channelName: '데모 스트리머',
          profileImageUrl: null,
          email: null,
          platformRole: 'SUPER_ADMIN',
          status: 'ACTIVE',
          createdAt: iso(ago(90 * 24 * HOUR)),
          lastLoginAt: iso(ago(2 * HOUR)),
        },
        tenants: [
          {
            id: TENANT_ID,
            slug: '데모-스트리머',
            chzzkChannelId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
            channelName: '데모 스트리머',
            status: 'ACTIVE',
            role: 'OWNER',
            createdAt: iso(ago(90 * 24 * HOUR)),
          },
          {
            id: 'tnt_second',
            slug: '서브채널',
            chzzkChannelId: 'ffffffffffffffffffffffffffffffff',
            channelName: '서브 채널 (합방용)',
            status: 'PAUSED',
            role: 'MANAGER',
            createdAt: iso(ago(10 * 24 * HOUR)),
          },
        ],
        activeTenantId: TENANT_ID,
      }),
    },

    { pattern: new RegExp(`^${t}/config$`), body: mockConfig },

    {
      pattern: new RegExp(`^${t}/bot$`),
      body: () => ({
        account: {
          channelId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
          channelName: '데모 스트리머',
        },
        instance: {
          tenantId: TENANT_ID,
          status: 'JOINED',
          joinedBy: '데모 스트리머',
          joinedAt: iso(ago(2 * HOUR)),
          chatChannelId: 'chat_demo',
          lastHeartbeatAt: iso(Date.now()),
          lastError: null,
          stats: {
            startedAt: ago(2 * HOUR),
            messagesSeen: 4821,
            commandsRun: 213,
            autoResponsesSent: 46,
            moderationActions: 9,
            spamBlocked: 31,
            pointsAwarded: 48_210,
            lastChatAt: ago(4000),
            uniqueChatters: 312,
          },
        },
        stats: {
          startedAt: ago(2 * HOUR),
          messagesSeen: 4821,
          commandsRun: 213,
          autoResponsesSent: 46,
          moderationActions: 9,
          spamBlocked: 31,
          pointsAwarded: 48_210,
          lastChatAt: ago(4000),
          uniqueChatters: 312,
        },
      }),
    },

    {
      pattern: new RegExp(`^${t}/usage$`),
      body: () => ({
        counts: { commands: 5, autoResponses: 2, bannedWords: 2, timers: 2 },
        limits: {
          maxCommands: null,
          maxAutoResponses: null,
          maxTimers: 50,
          maxBannedWords: null,
          maxChannels: 1,
          eventRetentionDays: 180,
          gamesEnabled: true,
          songRequestsEnabled: true,
          publicApiEnabled: true,
          apiRateLimitPerMinute: 120,
        },
      }),
    },

    {
      pattern: new RegExp(`^${t}/viewers$`),
      body: () => ({
        total: 312,
        users: [
          ['방구석연구원', 128_400, 2103, 21],
          ['치즈덕후', 96_200, 1544, 14],
          ['새벽세시감성', 71_050, 980, 7],
          ['아주아주긴닉네임을가진시청자님', 54_300, 733, 3],
          ['ㅇㅅㅇ', 41_900, 611, 12],
          ['개굴', 22_100, 388, 1],
          ['첫채팅', 10, 1, 0],
        ].map(([nickname, points, chatCount, streak], index) => ({
          channelId: `viewer_${index}`,
          nickname: nickname as string,
          points: points as number,
          chatCount: chatCount as number,
          firstSeenAt: ago((30 - index) * 24 * HOUR),
          lastSeenAt: ago(index * 900_000),
          attendanceStreak: streak as number,
          lastAttendanceDate: '',
        })),
      }),
    },

    {
      pattern: new RegExp(`^${t}/songs$`),
      body: () => ({
        playing: {
          id: 'song_now',
          title: '윤하 - 사건의 지평선',
          requesterChannelId: 'viewer_0',
          requesterNickname: '방구석연구원',
          status: 'playing',
          requestedAt: ago(30 * 60_000),
          startedAt: ago(3 * 60_000),
          finishedAt: null,
          pointsSpent: 100,
        },
        pending: [
          ['새소년 - 난춘', '치즈덕후'],
          ['잔나비 - 주저하는 연인들을 위해', '새벽세시감성'],
          ['아이유 - 밤편지', 'ㅇㅅㅇ'],
        ].map(([title, nickname], index) => ({
          id: `song_q${index}`,
          title: title as string,
          requesterChannelId: `viewer_${index + 1}`,
          requesterNickname: nickname as string,
          status: 'queued' as const,
          requestedAt: ago((20 - index * 5) * 60_000),
          startedAt: null,
          finishedAt: null,
          pointsSpent: 100,
        })),
        history: [
          {
            id: 'song_h0',
            title: '검정치마 - Everything',
            requesterChannelId: 'viewer_5',
            requesterNickname: '개굴',
            status: 'done' as const,
            requestedAt: ago(80 * 60_000),
            startedAt: ago(50 * 60_000),
            finishedAt: ago(45 * 60_000),
            pointsSpent: 100,
          },
        ],
      }),
    },

    {
      pattern: new RegExp(`^${t}/events`),
      body: () => {
        const rows: [string, string, string, string?][] = [
          ['command', '!데스 → 오늘 17번째 사망입니다...', '방구석연구원'],
          ['moderation', '금칙어 차단 + 임시제한', '광고봇123', 'https://spam.example'],
          ['donation', '10,000원 후원', '치즈덕후', '오늘도 화이팅!'],
          ['auto', '{user}님 안녕하세요! 반갑습니다 :)', '개굴'],
          ['subscription', '3개월 구독 (티어1)', '새벽세시감성'],
          ['song', '신청곡 추가 — 새소년 - 난춘', '치즈덕후'],
          ['command', '!멤버 → 오늘의 멤버 (2명): 빅헤드, 9구진', 'ㅇㅅㅇ'],
          ['system', '봇 입장', '데모 스트리머'],
        ];

        const events = rows
          .map(([kind, message, actor, detail], index) => ({
            id: rows.length - index,
            at: ago(index * 4 * 60_000),
            kind,
            message,
            actor,
            ...(detail ? { detail } : {}),
          }))
          .reverse();

        return { events, lastId: rows.length };
      },
    },

    {
      pattern: new RegExp(`^${t}/subscription$`),
      body: () => ({
        id: 'sub_demo',
        tenantId: TENANT_ID,
        plan: {
          id: 'plan_pro',
          code: 'PRO',
          name: '프로',
          description: '매니저와 함께 운영하고 외부 연동까지 쓰는 채널용입니다.',
          priceMonthly: 12_900,
          currency: 'KRW',
          features: ['명령어 · 자동응답 무제한', '명령 실행 API (분당 120회)', '매니저 초대'],
          limits: {
            maxCommands: null,
            maxAutoResponses: null,
            maxTimers: 50,
            maxBannedWords: null,
            maxChannels: 1,
            eventRetentionDays: 180,
            gamesEnabled: true,
            songRequestsEnabled: true,
            publicApiEnabled: true,
            apiRateLimitPerMinute: 120,
          },
          isPublic: true,
          sortOrder: 2,
        },
        status: 'ACTIVE',
        currentPeriodStart: iso(ago(12 * 24 * HOUR)),
        currentPeriodEnd: iso(ago(-18 * 24 * HOUR)),
        cancelAtPeriodEnd: false,
        canceledAt: null,
        trialEndsAt: null,
        hasBillingKey: true,
      }),
    },

    // ─ 치지직 콘솔: 스트리머 권한이 없는 상태를 재현합니다.
    //   이 경로들은 실제로도 자주 실패하므로, 실패 화면을 기본으로 보는 편이 낫습니다.
    {
      pattern: new RegExp(`^${t}/chzzk/(restrictions|chat-settings|audience|managers)`),
      body: () => ({
        __status: 400,
        error: { code: 'UPSTREAM_ERROR', message: '스트리머가 아닙니다.' },
      }),
    },

    {
      // 실제 API 와 같은 값을 돌려줍니다 — 카탈로그는 공유 패키지에 있습니다.
      pattern: /^\/api\/system\/variables$/,
      body: () => ({
        variables: SYSTEM_VARIABLES,
        groupLabels: SYSTEM_VARIABLE_GROUP_LABELS,
      }),
    },

    { pattern: /^\/api\/plans$/, body: () => ({ plans: [] }) },
    { pattern: /^\/api\/billing\/cards$/, body: () => ({ cards: [] }) },
    {
      pattern: /^\/api\/billing\/config$/,
      body: () => ({ provider: 'mock', storeId: 'store-mock', channelKey: 'channel-mock' }),
    },
    { pattern: new RegExp(`^${t}/payments$`), body: () => ({ payments: [] }) },
  ];
}

/**
 * `window.fetch` 를 가로챕니다.
 *
 * `/api/` 로 시작하지 않는 요청은 그대로 흘려보냅니다. Vite 의 HMR 과 모듈
 * 로딩까지 목이 삼키면 개발 자체가 안 됩니다.
 */
export function installDevMock(): void {
  const table = routes();
  const original = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]!;

    if (!path.startsWith('/api/')) return original(input, init);

    const method = (init?.method ?? 'GET').toUpperCase();
    const matched = table.find((route) => route.pattern.test(path));

    // 사람이 화면에서 느끼는 지연을 흉내 냅니다. 0ms 면 로딩 상태를 볼 수 없습니다.
    await new Promise((resolve) => setTimeout(resolve, 120));

    if (!matched) {
      // 쓰기 요청은 전부 성공시킵니다. 목 데이터를 실제로 갱신하지는 않으므로
      // 화면은 다시 불러온 뒤 원래 값으로 돌아갑니다 — 의도된 동작입니다.
      if (method !== 'GET') return json({ ok: true }, 200);

      console.warn(`[mock] 정의되지 않은 경로: ${method} ${path}`);
      return json({ error: { code: 'NOT_FOUND', message: `목에 없는 경로: ${path}` } }, 404);
    }

    if (method !== 'GET') return json({ ok: true }, 200);

    const body = matched.body() as { __status?: number };
    if (body.__status) return json(body, body.__status);
    return json(body, 200);
  };

  console.info('[mock] API 목을 켰습니다. 실제 서버에는 요청하지 않습니다.');
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
