import { describe, expect, it } from 'vitest';
import { matches, isValidPattern } from '../src/features/matcher.js';
import { CooldownTracker } from '../src/features/cooldown.js';
import { AutoResponder } from '../src/features/autoResponder.js';
import { Moderator } from '../src/features/moderation.js';
import { botConfig } from '@chzzk-bot/contracts';
import type { ChatEvent, UserRoleCode } from '@chzzk-bot/chzzk-sdk';

function chat(content: string, role: UserRoleCode = 'common_user'): ChatEvent {
  return {
    channelId: 'ch',
    senderChannelId: 'viewer',
    chatChannelId: 'chat',
    profile: { nickname: '홍길동', badges: [], verifiedMark: false },
    userRoleCode: role,
    content,
    emojis: {},
    messageTime: 1_700_000_000_000,
  };
}

describe('matcher', () => {
  it('contains / equals / startsWith 를 구분한다', () => {
    expect(matches('안녕하세요 여러분', '안녕', 'contains')).toBe(true);
    expect(matches('안녕하세요 여러분', '안녕', 'equals')).toBe(false);
    expect(matches('안녕', '안녕', 'equals')).toBe(true);
    expect(matches('안녕하세요', '안녕', 'startsWith')).toBe(true);
    expect(matches('그래 안녕', '안녕', 'startsWith')).toBe(false);
  });

  it('기본은 대소문자를 무시한다', () => {
    expect(matches('Hello', 'hello', 'contains')).toBe(true);
    expect(matches('Hello', 'hello', 'contains', true)).toBe(false);
  });

  it('정규식을 지원한다', () => {
    expect(matches('주문번호 12345', '\\d{5}', 'regex')).toBe(true);
  });

  it('잘못된 정규식은 봇을 죽이지 않고 매칭 실패로 처리한다', () => {
    expect(matches('아무거나', '[', 'regex')).toBe(false);
    expect(isValidPattern('[', 'regex')).toBe(false);
    expect(isValidPattern('\\d+', 'regex')).toBe(true);
  });
});

describe('CooldownTracker', () => {
  it('쿨다운이 0이면 항상 통과시킨다', () => {
    const t = new CooldownTracker();
    expect(t.tryUse('k', 0)).toBe(true);
    expect(t.tryUse('k', 0)).toBe(true);
  });

  it('시간이 지나면 다시 쓸 수 있다', () => {
    const t = new CooldownTracker();
    const now = 1000;
    expect(t.tryUse('k', 5, now)).toBe(true);
    expect(t.tryUse('k', 5, now + 1000)).toBe(false);
    expect(t.remaining('k', now + 1000)).toBe(4);
    expect(t.tryUse('k', 5, now + 6000)).toBe(true);
  });

  it('키가 다르면 서로 영향을 주지 않는다', () => {
    const t = new CooldownTracker();
    expect(t.tryUse('a', 10)).toBe(true);
    expect(t.tryUse('b', 10)).toBe(true);
  });
});

describe('AutoResponder', () => {
  const config = botConfig.parse({
    autoResponses: [
      {
        id: 'ar1',
        pattern: '안녕',
        mode: 'contains',
        response: '{user}님 안녕하세요!',
        cooldownSec: 30,
      },
    ],
  });

  it('키워드에 반응하고 닉네임을 채운다', () => {
    const responder = new AutoResponder();
    expect(responder.respond(chat('안녕하세요'), config)).toBe('홍길동님 안녕하세요!');
  });

  it('쿨다운 중에는 다시 답하지 않는다', () => {
    const responder = new AutoResponder();
    responder.respond(chat('안녕'), config);
    expect(responder.respond(chat('안녕'), config)).toBeNull();
  });

  it('꺼진 규칙은 무시한다', () => {
    const off = botConfig.parse({
      autoResponses: [{ id: 'ar1', pattern: '안녕', response: '응답', enabled: false }],
    });
    expect(new AutoResponder().respond(chat('안녕'), off)).toBeNull();
  });

  it('확률이 떨어지면 쿨다운을 소모하지 않는다', () => {
    const always = () => 0.99; // chancePercent 50 이면 항상 실패
    const config50 = botConfig.parse({
      autoResponses: [{ id: 'ar1', pattern: '안녕', response: '응답', chancePercent: 50 }],
    });
    const responder = new AutoResponder(always);
    expect(responder.respond(chat('안녕'), config50)).toBeNull();

    // 확률에 걸리지 않았을 뿐이므로, 다음 시도는 바로 가능해야 합니다.
    const lucky = new AutoResponder(() => 0);
    expect(lucky.respond(chat('안녕'), config50)).toBe('응답');
  });
});

describe('Moderator', () => {
  const config = botConfig.parse({
    moderation: {
      enabled: true,
      allowTempBan: false,
      words: [
        { id: 'w1', pattern: '금칙', mode: 'contains', action: 'blindAndWarn' },
        { id: 'w2', pattern: '심각', mode: 'contains', action: 'blindAndTempBan' },
      ],
    },
  });

  it('금칙어를 잡아내고 경고 문구를 만든다', () => {
    const verdict = new Moderator().inspect(chat('이건 금칙어야'), config);
    expect(verdict?.blind).toBe(true);
    expect(verdict?.warn).toContain('홍길동');
  });

  it('스트리머와 매니저는 검사에서 제외된다', () => {
    expect(new Moderator().inspect(chat('금칙', 'streamer'), config)).toBeNull();
    expect(new Moderator().inspect(chat('금칙', 'streaming_channel_manager'), config)).toBeNull();
  });

  it('allowTempBan 이 꺼져 있으면 임시제한을 실행하지 않는다', () => {
    const verdict = new Moderator().inspect(chat('심각한 말'), config);
    expect(verdict?.blind).toBe(true);
    expect(verdict?.tempBan).toBe(false);
  });

  it('allowTempBan 을 켜면 임시제한까지 판정한다', () => {
    const on = botConfig.parse({
      moderation: {
        allowTempBan: true,
        words: [{ id: 'w2', pattern: '심각', action: 'blindAndTempBan' }],
      },
    });
    expect(new Moderator().inspect(chat('심각'), on)?.tempBan).toBe(true);
  });

  it('기능을 끄면 아무것도 잡지 않는다', () => {
    const off = botConfig.parse({
      moderation: { enabled: false, words: [{ id: 'w1', pattern: '금칙' }] },
    });
    expect(new Moderator().inspect(chat('금칙'), off)).toBeNull();
  });

  it('깨끗한 메시지는 통과시킨다', () => {
    expect(new Moderator().inspect(chat('안녕하세요'), config)).toBeNull();
  });
});
