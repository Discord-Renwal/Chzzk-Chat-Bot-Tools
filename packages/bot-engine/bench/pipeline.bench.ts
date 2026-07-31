import { bench, describe } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonConfigStore } from '../src/state/configStore.js';
import { Moderator } from '../src/features/moderation.js';
import { SpamFilter } from '../src/features/spamFilter.js';
import { AutoResponder } from '../src/features/autoResponder.js';
import { matches } from '../src/features/matcher.js';
import { expandVariables, type ChannelContext } from '../src/features/variables.js';
import { JsonViewerStore } from '../src/state/userStore.js';
import { botConfig, spamSettings } from '@chzzk-bot/contracts';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';

/**
 * 채팅 1건을 처리하는 경로의 비용을 잽니다.
 *
 * 실제 방송에서는 초당 수십 건의 채팅이 들어오고, 그 하나하나가 아래 경로를
 * 전부 지나갑니다. 그래서 "한 번에 얼마" 보다 "메시지당 얼마" 가 중요합니다.
 * 규모가 커졌을 때 무너지는지 보려고 명령어·금칙어를 넉넉히 넣고 잽니다.
 */

const dir = mkdtempSync(join(tmpdir(), 'chzzk-bench-'));

function chat(content: string): ChatEvent {
  return {
    channelId: 'ch',
    senderChannelId: 'viewer-1',
    chatChannelId: 'chat',
    profile: { nickname: '홍길동', badges: [], verifiedMark: false },
    userRoleCode: 'common_user',
    content,
    emojis: {},
    messageTime: Date.now(),
  };
}

/** 실사용에서 충분히 나올 수 있는 규모 */
const HEAVY = botConfig.parse({
  commands: Array.from({ length: 40 }, (_, i) => ({
    id: `cmd_${i}`,
    name: `명령${i}`,
    aliases: [`cmd${i}`],
    response: '응답 $닉네임',
  })),
  autoResponses: Array.from({ length: 30 }, (_, i) => ({
    id: `ar_${i}`,
    pattern: `키워드${i}`,
    response: '자동 응답',
  })),
  moderation: {
    enabled: true,
    words: Array.from({ length: 50 }, (_, i) => ({
      id: `w_${i}`,
      pattern: `금칙어${i}`,
    })),
    spam: { enabled: true, maxRepeatedChars: 5, blockLinks: true, duplicateWindowSec: 30 },
  },
});

const CLEAN = chat('안녕하세요 오늘 방송 재미있네요');

// 비동기 준비는 모듈 최상위에서 끝내 둡니다. describe 콜백은 동기여야 합니다.
const store = await JsonConfigStore.open(join(dir, 'config.json'));
await store.replace(HEAVY);
const users = await JsonViewerStore.open(join(dir, 'users.json'));

describe('설정 스냅샷', () => {
  // 채팅 1건마다 최소 두 번 호출됩니다.
  bench('snapshot() — 메시지당 2~3회 호출', () => {
    store.snapshot();
  });
});

describe('금칙어 검사 (50개)', () => {
  const moderator = new Moderator();

  bench('깨끗한 메시지 — 50개 전부 비교', () => {
    moderator.inspect(CLEAN, HEAVY);
  });
});

describe('스팸 필터', () => {
  const filter = new SpamFilter();
  const settings = spamSettings.parse({
    enabled: true,
    maxRepeatedChars: 5,
    blockLinks: true,
    duplicateWindowSec: 30,
  });

  bench('깨끗한 메시지', () => {
    filter.inspect(chat(`안녕하세요 ${Math.random()}`), settings);
  });
});

describe('자동응답 (30개)', () => {
  const responder = new AutoResponder();

  bench('매칭 없음 — 30개 전부 비교', () => {
    responder.respond(CLEAN, HEAVY);
  });
});

describe('정규식 매칭', () => {
  bench('regex 모드 — 매번 컴파일되는지', () => {
    matches('주문번호 12345 입니다', '\\d{5}', 'regex');
  });

  bench('contains 모드 (비교군)', () => {
    matches('주문번호 12345 입니다', '12345', 'contains');
  });
});

describe('변수 치환', () => {
  const ctx = {
    event: CLEAN,
    query: '',
    commandCount: 1,
    userCount: 1,
    channel: { liveTitle: '방송', liveCategory: '게임' } as ChannelContext,
    users,
    botStartedAt: Date.now(),
  };

  bench('$닉네임 님 반갑습니다', () => {
    expandVariables('$닉네임 님 반갑습니다', ctx);
  });

  bench('변수 없는 문자열 (비교군)', () => {
    expandVariables('그냥 고정 문구입니다', ctx);
  });
});
