import { describe, expect, it } from 'vitest';
import {
  SYSTEM_VARIABLES,
  allSystemVariableNames,
  type SystemVariable,
} from '@chzzk-bot/contracts';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import { expandVariables } from '../src/features/variables.js';
import type { ChannelContext } from '../src/features/variables.js';
import type { ViewerStore } from '../src/ports.js';

/**
 * 카탈로그(contracts)와 엔진(resolvers)이 갈라지지 않게 붙들어 둡니다.
 *
 * 화면은 카탈로그를 그대로 안내하므로, 카탈로그에만 있고 엔진이 모르는 이름은
 * "안내는 했는데 치환은 안 되는" 변수가 됩니다. 반대로 엔진에만 있는 이름은
 * 아무도 쓸 줄 모르는 기능이 됩니다. 둘 다 사용자가 먼저 발견하게 두면 안 됩니다.
 */

const channel = {
  liveTitle: '오늘은 랭크 갑니다',
  liveCategory: 'League of Legends',
} as unknown as ChannelContext;

const users = {
  get: () => ({
    channelId: 'ch_a',
    nickname: '방구석연구원',
    points: 12_800,
    chatCount: 2103,
    firstSeenAt: 0,
    lastSeenAt: 0,
    attendanceStreak: 21,
    lastAttendanceDate: '',
  }),
} as unknown as ViewerStore;

const event = {
  channelId: 'ch_owner',
  senderChannelId: 'ch_a',
  chatChannelId: 'chat_1',
  profile: { nickname: '방구석연구원', badges: [], verifiedMark: false },
  userRoleCode: 'common_user',
  content: '',
  emojis: {},
  messageTime: Date.now(),
} as ChatEvent;

function expand(template: string): string {
  return expandVariables(template, {
    event,
    query: '안녕하세요',
    commandCount: 17,
    userCount: 3,
    channel,
    users,
    botStartedAt: Date.now() - 8_000_000,
  });
}

/** 명령 고유 변수는 `expandCommandValue` 가 따로 채웁니다. 여기서는 제외합니다. */
const runtimeVariables = SYSTEM_VARIABLES.filter((v) => v.onlyFor === undefined);

describe('시스템 변수 카탈로그', () => {
  it('대표 이름이 중복되지 않는다', () => {
    const names = SYSTEM_VARIABLES.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('별칭까지 합쳐도 중복이 없다', () => {
    const all = allSystemVariableNames();
    expect(new Set(all).size).toBe(all.length);
  });

  it.each(runtimeVariables.map((v) => [v.name, v] as const))(
    '$%s 를 엔진이 실제로 치환한다',
    (name, variable: SystemVariable) => {
      // 치환되면 원문이 그대로 남아 있지 않습니다.
      expect(expand(`[$${name}]`)).not.toBe(`[$${name}]`);
      expect(expand(`[{${name}}]`)).not.toBe(`[{${name}}]`);

      for (const alias of variable.aliases) {
        expect(expand(`[$${alias}]`)).not.toBe(`[$${alias}]`);
      }
    }
  );

  it('모르는 이름은 원문 그대로 남긴다 — 오타를 조용히 지우지 않기 위해', () => {
    expect(expand('$없는변수')).toBe('$없는변수');
  });

  it('카탈로그에 없는 이름을 엔진이 몰래 지원하지 않는다', () => {
    // 엔진이 아는 이름은 전부 카탈로그에 있어야 합니다. 목록에 없는 기능은
    // 문서화되지 않은 기능이고, 언젠가 말없이 사라집니다.
    const known = new Set(allSystemVariableNames().map((n) => n.toLowerCase()));

    // resolvers 는 내보내지 않으므로, 치환 여부로 역으로 확인합니다.
    const suspects = ['닉네임', 'name', 'user', 'title', 'game', 'count', 'point', 'query'];
    for (const suspect of suspects) {
      const replaced = expand(`[$${suspect}]`) !== `[$${suspect}]`;
      expect(
        replaced === known.has(suspect.toLowerCase()),
        `${suspect}: 엔진 치환=${replaced}, 카탈로그 등재=${known.has(suspect.toLowerCase())}`
      ).toBe(true);
    }
  });
});
