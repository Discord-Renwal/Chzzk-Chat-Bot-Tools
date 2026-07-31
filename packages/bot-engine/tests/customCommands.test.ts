import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonConfigStore } from '../src/state/configStore.js';
import { CustomCommandEngine, parseItems } from '../src/features/customCommands.js';
import type { ChatEvent, UserRoleCode } from '@chzzk-bot/chzzk-sdk';

let dir: string;
let store: JsonConfigStore;
let engine: CustomCommandEngine;

function chat(content: string, role: UserRoleCode = 'common_user'): ChatEvent {
  return {
    channelId: 'ch',
    senderChannelId: role === 'streamer' ? 'owner' : `viewer-${role}`,
    chatChannelId: 'chat',
    profile: { nickname: '닉네임', badges: [], verifiedMark: false },
    userRoleCode: role,
    content,
    emojis: {},
    messageTime: Date.now(),
  };
}

/** `!멤버 빅헤드,9구진` 형태의 입력을 런타임과 같은 방식으로 쪼갭니다. */
async function run(content: string, role: UserRoleCode = 'common_user') {
  const config = store.snapshot();
  const [name, ...args] = content.slice(1).trim().split(/\s+/);
  return engine.execute(chat(content, role), config, name!, args);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chzzk-test-'));
  store = await JsonConfigStore.open(join(dir, 'config.json'));
  engine = new CustomCommandEngine(store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseItems', () => {
  it('쉼표로 나눈다', () => {
    expect(parseItems('빅헤드,9구진')).toEqual(['빅헤드', '9구진']);
  });

  it('쉼표 뒤 공백을 정리한다', () => {
    expect(parseItems('빅헤드, 9구진 , 홍길동')).toEqual(['빅헤드', '9구진', '홍길동']);
  });

  it('쉼표가 없으면 공백으로 나눈다', () => {
    expect(parseItems('빅헤드 9구진')).toEqual(['빅헤드', '9구진']);
  });

  it('쉼표가 있으면 공백으로는 나누지 않는다 — 이름에 공백이 있을 수 있다', () => {
    expect(parseItems('빅 헤드,9구진')).toEqual(['빅 헤드', '9구진']);
  });
});

describe('!멤버 — 요청하신 시나리오', () => {
  it('스트리머가 등록하면 일반 시청자가 조회할 수 있다', async () => {
    const set = await run('!멤버 빅헤드,9구진', 'streamer');
    expect(set.handled).toBe(true);
    expect(set.reply).toContain('빅헤드, 9구진');

    // 다른 사람이 조회
    const read = await run('!멤버');
    expect(read.reply).toBe('오늘의 멤버 (2명): 빅헤드, 9구진');
  });

  it('등록한 값이 디스크에 남아 재시작해도 유지된다', async () => {
    await run('!멤버 빅헤드,9구진', 'streamer');

    const reopened = await JsonConfigStore.open(join(dir, 'config.json'));
    expect(reopened.findCommand('멤버')?.items).toEqual(['빅헤드', '9구진']);
  });

  it('별칭으로도 동작한다', async () => {
    await run('!멤버 빅헤드', 'streamer');
    const read = await run('!팀');
    expect(read.reply).toContain('빅헤드');
  });

  it('일반 시청자는 목록을 바꿀 수 없다', async () => {
    const result = await run('!멤버 침입자', 'common_user');
    expect(result.reply).toContain('스트리머·매니저만');
    expect(store.findCommand('멤버')?.items).toEqual([]);
  });

  it('비어 있으면 등록 방법을 안내한다', async () => {
    const result = await run('!멤버');
    expect(result.reply).toContain('!멤버 이름1,이름2');
  });

  it('추가 / 삭제 / 초기화가 동작한다', async () => {
    await run('!멤버 빅헤드,9구진', 'streamer');

    await run('!멤버 추가 홍길동', 'streamer');
    expect(store.findCommand('멤버')?.items).toEqual(['빅헤드', '9구진', '홍길동']);

    await run('!멤버 삭제 9구진', 'streamer');
    expect(store.findCommand('멤버')?.items).toEqual(['빅헤드', '홍길동']);

    await run('!멤버 초기화', 'streamer');
    expect(store.findCommand('멤버')?.items).toEqual([]);
  });

  it('중복 이름은 한 번만 저장된다', async () => {
    await run('!멤버 빅헤드,빅헤드,9구진', 'streamer');
    expect(store.findCommand('멤버')?.items).toEqual(['빅헤드', '9구진']);
  });

  it('이미 있는 이름을 추가해도 늘어나지 않는다', async () => {
    await run('!멤버 빅헤드', 'streamer');
    await run('!멤버 추가 빅헤드', 'streamer');
    expect(store.findCommand('멤버')?.items).toEqual(['빅헤드']);
  });

  it('없는 이름을 지우려 하면 알려준다', async () => {
    await run('!멤버 빅헤드', 'streamer');
    const result = await run('!멤버 삭제 없는사람', 'streamer');
    expect(result.reply).toContain('없습니다');
  });
});

describe('쿨다운', () => {
  it('연속 조회는 두 번째부터 응답하지 않는다', async () => {
    await run('!멤버 빅헤드', 'streamer');

    const first = await run('!멤버');
    const second = await run('!멤버');

    expect(first.reply).not.toBeNull();
    expect(second.reply).toBeNull();
    // 명령을 인식은 했으므로 자동응답으로 흘러가면 안 됩니다.
    expect(second.handled).toBe(true);
  });

  it('수정은 쿨다운의 영향을 받지 않는다', async () => {
    await run('!멤버 A', 'streamer');
    const second = await run('!멤버 B', 'streamer');
    expect(second.reply).toContain('B');
  });
});

describe('없는 명령어', () => {
  it('handled=false 로 넘겨 자동응답이 처리할 수 있게 한다', async () => {
    const result = await run('!없는명령');
    expect(result).toEqual({ reply: null, handled: false });
  });
});
