import { describe, expect, it, vi } from 'vitest';
import { CommandRouter } from '../src/bot/commandRouter.js';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';

function chat(content: string, overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    channelId: 'channel-1',
    senderChannelId: 'viewer-1',
    chatChannelId: 'chat-1',
    profile: { nickname: '시청자', badges: [], verifiedMark: false },
    userRoleCode: 'common_user',
    content,
    emojis: {},
    messageTime: 1_700_000_000_000,
    ...overrides,
  };
}

const noReply = async () => {};

describe('CommandRouter', () => {
  it('접두사가 붙은 명령을 실행한다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter().register({ name: 'ping', handler });

    expect(await router.handle(chat('!ping'), noReply)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('접두사가 없으면 무시한다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter().register({ name: 'ping', handler });

    expect(await router.handle(chat('ping'), noReply)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('별칭과 대소문자 무시가 동작한다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter().register({ name: 'ping', aliases: ['핑'], handler });

    await router.handle(chat('!핑'), noReply);
    await router.handle(chat('!PING'), noReply);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('인자를 분리해 전달한다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter().register({ name: 'say', handler });

    await router.handle(chat('!say 안녕  하세요'), noReply);
    expect(handler.mock.calls[0]?.[0]).toMatchObject({
      args: ['안녕', '하세요'],
      rest: '안녕 하세요',
    });
  });

  it('허용되지 않은 역할은 차단한다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter().register({
      name: 'ban',
      allowedRoles: ['streamer'],
      handler,
    });

    expect(await router.handle(chat('!ban'), noReply)).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    await router.handle(chat('!ban', { userRoleCode: 'streamer' }), noReply);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('봇 자신의 메시지는 무시해 루프를 막는다', async () => {
    const handler = vi.fn();
    const router = new CommandRouter({ botChannelId: 'bot-1' }).register({ name: 'ping', handler });

    expect(await router.handle(chat('!ping', { senderChannelId: 'bot-1' }), noReply)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('쿨다운 중에는 다시 실행하지 않는다', async () => {
    vi.useFakeTimers();
    const handler = vi.fn();
    const router = new CommandRouter().register({ name: 'ping', cooldownMs: 5000, handler });

    await router.handle(chat('!ping'), noReply);
    await router.handle(chat('!ping'), noReply);
    expect(handler).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5001);
    await router.handle(chat('!ping'), noReply);
    expect(handler).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('핸들러가 던진 예외는 onError 로 전달된다', async () => {
    const onError = vi.fn();
    const router = new CommandRouter({ onError }).register({
      name: 'boom',
      handler: () => {
        throw new Error('실패');
      },
    });

    expect(await router.handle(chat('!boom'), noReply)).toBe(true);
    expect(onError).toHaveBeenCalledOnce();
  });
});
