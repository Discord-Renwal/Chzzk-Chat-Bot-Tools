import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ChzzkClient, UserRoleCode } from '@chzzk-bot/chzzk-sdk';
import { botConfig, starterConfig, type BotConfig, type CustomCommand } from '@chzzk-bot/contracts';
import { noopLogger } from '@chzzk-bot/logger';
import { BotRuntime } from '../src/bot/runtime.js';
import { EventLog } from '../src/state/eventLog.js';
import type { ConfigSource, SongStore, ViewerStore } from '../src/ports.js';

/**
 * `!입장` 게이트와 명령 실행 API.
 *
 * 이 두 가지가 멀티테넌트 전환에서 새로 생긴 동작이라, 회귀가 가장 아픈 지점입니다.
 * 봇이 부르지도 않았는데 말하기 시작하거나, 반대로 스트리머가 불러도 반응하지
 * 않으면 방송 중에 바로 드러납니다.
 */

// ─── 테스트 더블 ──────────────────────────────────────────────────────────────

function makeConfigSource(config: BotConfig): ConfigSource {
  let current = config;
  return {
    snapshot: () => current,
    findCommand: (nameOrAlias) => {
      const key = nameOrAlias.toLowerCase();
      return current.commands.find(
        (c) => c.name.toLowerCase() === key || c.aliases.some((a) => a.toLowerCase() === key)
      );
    },
    setCommandItems: async (id, items) => {
      current = {
        ...current,
        commands: current.commands.map((c) => (c.id === id ? { ...c, items } : c)),
      };
    },
    bumpCommandUsage: async (id, delta = 0) => {
      let count = 0;
      current = {
        ...current,
        commands: current.commands.map((c) => {
          if (c.id !== id) return c;
          count = c.count + delta;
          return { ...c, usedCount: c.usedCount + 1, count };
        }),
      };
      return count;
    },
    bumpBannedWordHit: async () => {},
    upsertCommand: async (input) => input as CustomCommand,
    refresh: async () => current,
    on: () => undefined,
  };
}

function makeViewerStore(): ViewerStore {
  return {
    get: () => undefined,
    isFirstEver: () => false,
    recordChat: () => 0,
    addPoints: () => 0,
    spendPoints: () => false,
    checkAttendance: () => ({ checked: false, streak: 0, reward: 0 }),
    topByPoints: () => [],
    topByChat: () => [],
    rankOf: () => null,
    userCount: 0,
    all: () => [],
    resetAllPoints: () => {},
    flush: async () => {},
  };
}

function makeSongStore(): SongStore {
  return {
    pending: () => [],
    playing: () => undefined,
    all: () => [],
    pendingCountBy: () => 0,
    hasPendingTitle: () => false,
    add: () => {
      throw new Error('이 테스트에서는 신청곡을 쓰지 않습니다.');
    },
    next: () => null,
    skip: () => null,
    cancelOwn: () => null,
    remove: () => false,
    move: () => false,
    clearPending: () => 0,
    flush: async () => {},
  };
}

/** 보낸 메시지를 모아 두는 가짜 치지직 클라이언트 */
function makeChzzk(sent: string[]): ChzzkClient {
  return {
    logger: noopLogger,
    chat: {
      send: vi.fn(async (message: string) => {
        sent.push(message);
      }),
      blindMessage: vi.fn(async () => {}),
    },
    channels: {
      get: vi.fn(async () => null),
      subscribers: vi.fn(async () => []),
    },
    lives: {
      getSetting: vi.fn(async () => ({ defaultLiveTitle: '', category: null })),
    },
    restrictions: {
      temporaryRestrict: vi.fn(async () => {}),
    },
  } as unknown as ChzzkClient;
}

function chat(content: string, role: UserRoleCode = 'common_user'): ChatEvent {
  return {
    channelId: 'ch_owner',
    senderChannelId: role === 'streamer' ? 'ch_owner' : 'ch_viewer',
    chatChannelId: 'chat_1',
    profile: {
      nickname: role === 'streamer' ? '스트리머' : '시청자',
      badges: [],
      verifiedMark: false,
    },
    userRoleCode: role,
    content,
    emojis: {},
    messageTime: Date.now(),
  };
}

function makeRuntime(config: BotConfig = starterConfig()) {
  const sent: string[] = [];
  const runtime = new BotRuntime({
    chzzk: makeChzzk(sent),
    config: makeConfigSource(config),
    users: makeViewerStore(),
    songs: makeSongStore(),
    log: new EventLog(),
    botChannelId: 'ch_bot',
  });
  return { runtime, sent };
}

// 채팅 전송은 큐를 거치므로 한 틱 기다려야 배열에 담깁니다.
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('입장 게이트', () => {
  let harness: ReturnType<typeof makeRuntime>;

  beforeEach(() => {
    harness = makeRuntime();
  });

  it('입장 전에는 명령어에 응답하지 않는다', async () => {
    await harness.runtime.handleChat(chat('!디스코드'));
    await flush();

    expect(harness.runtime.isJoined).toBe(false);
    expect(harness.sent).toEqual([]);
  });

  it('시청자는 봇을 입장시킬 수 없다', async () => {
    await harness.runtime.handleChat(chat('!입장'));
    await flush();

    expect(harness.runtime.isJoined).toBe(false);
    expect(harness.sent).toEqual([]);
  });

  it('스트리머가 !입장 을 치면 들어오고, 그 뒤로 명령어가 동작한다', async () => {
    await harness.runtime.handleChat(chat('!입장', 'streamer'));
    await flush();

    expect(harness.runtime.isJoined).toBe(true);
    expect(harness.runtime.joinedBy).toBe('스트리머');
    expect(harness.sent[0]).toContain('입장했습니다');

    await harness.runtime.handleChat(chat('!디스코드'));
    await flush();

    expect(harness.sent.some((m) => m.includes('디스코드 주소'))).toBe(true);
  });

  it('매니저도 입장시킬 수 있다', async () => {
    await harness.runtime.handleChat(chat('!입장', 'streaming_chat_manager'));
    await flush();

    expect(harness.runtime.isJoined).toBe(true);
  });

  it('!퇴장 이후에는 다시 조용해진다', async () => {
    await harness.runtime.handleChat(chat('!입장', 'streamer'));
    await harness.runtime.handleChat(chat('!퇴장', 'streamer'));
    await flush();

    expect(harness.runtime.isJoined).toBe(false);
    harness.sent.length = 0;

    await harness.runtime.handleChat(chat('!디스코드'));
    await flush();
    expect(harness.sent).toEqual([]);
  });

  it('이미 입장한 상태에서 !입장 을 또 치면 안내만 한다', async () => {
    await harness.runtime.handleChat(chat('!입장', 'streamer'));
    await flush();
    harness.sent.length = 0;

    await harness.runtime.handleChat(chat('!입장', 'streamer'));
    await flush();

    expect(harness.sent).toEqual(['이미 입장해 있습니다.']);
  });

  it('autoJoin 을 주면 !입장 없이 바로 동작한다 — 로컬 단일 채널 모드', async () => {
    const sent: string[] = [];
    const runtime = new BotRuntime({
      chzzk: makeChzzk(sent),
      config: makeConfigSource(starterConfig()),
      users: makeViewerStore(),
      songs: makeSongStore(),
      log: new EventLog(),
      botChannelId: 'ch_bot',
      autoJoin: true,
    });

    expect(runtime.isJoined).toBe(true);

    await runtime.handleChat(chat('!디스코드'));
    await flush();
    expect(sent.some((m) => m.includes('디스코드 주소'))).toBe(true);
  });

  it('입장/퇴장을 바깥에 알려준다 — Core 가 DB 상태를 맞추는 신호', async () => {
    const changes: { joined: boolean; by: string | null }[] = [];
    const runtime = new BotRuntime({
      chzzk: makeChzzk([]),
      config: makeConfigSource(starterConfig()),
      users: makeViewerStore(),
      songs: makeSongStore(),
      log: new EventLog(),
      botChannelId: 'ch_bot',
      onJoinChange: (joined, by) => changes.push({ joined, by }),
    });

    await runtime.handleChat(chat('!입장', 'streamer'));
    await runtime.handleChat(chat('!퇴장', 'streamer'));
    await flush();

    expect(changes).toEqual([
      { joined: true, by: '스트리머' },
      { joined: false, by: null },
    ]);
  });

  it('봇이 꺼져 있으면(general.enabled=false) 입장 명령도 무시한다', async () => {
    const config = botConfig.parse({ ...starterConfig(), general: { enabled: false } });
    const { runtime, sent } = makeRuntime(config);

    await runtime.handleChat(chat('!입장', 'streamer'));
    await flush();

    expect(runtime.isJoined).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('명령 실행 API', () => {
  it('채팅을 거치지 않고 결과 문장을 돌려준다', async () => {
    const { runtime, sent } = makeRuntime();

    const result = await runtime.executeCommand({
      command: '디스코드',
      args: [],
      broadcast: false,
      dryRun: true,
    });

    expect(result.handled).toBe(true);
    expect(result.source).toBe('custom');
    expect(result.output).toContain('디스코드 주소');
    expect(result.broadcast).toBe(false);
    // 기본값은 미리보기입니다. 시험해 본 문구가 방송에 새어 나가면 안 됩니다.
    expect(sent).toEqual([]);
  });

  it('없는 명령은 handled=false 와 이유를 돌려준다', async () => {
    const { runtime } = makeRuntime();

    const result = await runtime.executeCommand({
      command: '없는명령',
      args: [],
      broadcast: false,
      dryRun: true,
    });

    expect(result.handled).toBe(false);
    expect(result.source).toBe('none');
    expect(result.blockedReason).toContain('찾을 수 없습니다');
  });

  it('broadcast=true 면 실제 채팅으로도 보낸다', async () => {
    const { runtime, sent } = makeRuntime();

    const result = await runtime.executeCommand({
      command: '디스코드',
      args: [],
      broadcast: true,
      dryRun: true,
    });

    await flush();
    expect(result.broadcast).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('접두사를 붙여 보내도 같은 명령으로 인식한다', async () => {
    const { runtime } = makeRuntime();

    const result = await runtime.executeCommand({
      command: '!디스코드',
      args: [],
      broadcast: false,
      dryRun: true,
    });

    expect(result.handled).toBe(true);
  });

  it('도움말은 설정과 무관하게 항상 동작한다', async () => {
    const { runtime } = makeRuntime();

    const result = await runtime.executeCommand({
      command: '도움말',
      args: [],
      broadcast: false,
      dryRun: true,
    });

    expect(result.source).toBe('help');
    expect(result.output).toContain('디스코드');
  });

  it('입장하지 않아도 미리보기는 된다 — 설정을 확인할 수 있어야 하므로', async () => {
    const { runtime } = makeRuntime();
    expect(runtime.isJoined).toBe(false);

    const result = await runtime.executeCommand({
      command: '디스코드',
      args: [],
      broadcast: false,
      dryRun: true,
    });

    expect(result.handled).toBe(true);
  });
});
