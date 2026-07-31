import type { HttpClient } from '../core/http.js';
import { ChzzkValidationError } from '../core/errors.js';
import type {
  ChatAvailableCondition,
  ChatAvailableGroup,
  ChatSettings,
  SendMessageResult,
} from './types.js';

/** 문서상 메시지 길이 제한: 바이트가 아니라 **문자** 100자입니다. */
export const MAX_MESSAGE_LENGTH = 100;

/** `minFollowerMinute` 는 임의 값이 아니라 아래 목록 중 하나여야 합니다. */
export const ALLOWED_MIN_FOLLOWER_MINUTES = [
  0, 5, 10, 30, 60, 1440, 10080, 43200, 86400, 129600, 172800, 216000, 259200,
] as const;

/** `chatSlowModeSec` 허용값. 0 이면 슬로우 모드 해제입니다. */
export const ALLOWED_SLOW_MODE_SEC = [0, 3, 5, 10, 30, 60, 120, 300] as const;

export interface UpdateChatSettingsInput {
  chatAvailableCondition?: ChatAvailableCondition;
  chatAvailableGroup?: ChatAvailableGroup;
  minFollowerMinute?: (typeof ALLOWED_MIN_FOLLOWER_MINUTES)[number];
  allowSubscriberInFollowerMode?: boolean;
  chatSlowModeSec?: (typeof ALLOWED_SLOW_MODE_SEC)[number];
  chatEmojiMode?: boolean;
}

export interface BlindMessageInput {
  /** CHAT 이벤트의 `chatChannelId` */
  chatChannelId: string;
  /** CHAT 이벤트의 `messageTime` (ms timestamp) */
  messageTime: number;
  /** CHAT 이벤트의 `senderChannelId` */
  senderChannelId: string;
}

/**
 * 채팅 API. 모든 호출이 사용자 액세스 토큰을 요구합니다.
 *
 * 주의: `send` / `notice` 에는 채널을 지정하는 파라미터가 없습니다.
 * 대상 채널은 액세스 토큰 소유자의 채널로 고정되므로, 임의의 채널에 대신 글을 쓸 수는 없습니다.
 */
export class ChatApi {
  constructor(private readonly http: HttpClient) {}

  /** 메시지 전송. 스코프: 채팅 메시지 쓰기 */
  async send(message: string): Promise<SendMessageResult> {
    assertMessageLength(message);
    return this.http.request<SendMessageResult>({
      method: 'POST',
      path: '/open/v1/chats/send',
      auth: 'user',
      body: { message },
    });
  }

  /**
   * 공지 등록. 스코프: 채팅 공지 쓰기
   *
   * 새 메시지로 등록하려면 `{ message }`, 이미 전송된 메시지를 승격하려면 `{ messageId }` 를 넘깁니다.
   * (문서에 공지 **해제** 엔드포인트는 존재하지 않습니다.)
   */
  async setNotice(input: { message: string } | { messageId: string }): Promise<void> {
    if ('message' in input) assertMessageLength(input.message);
    await this.http.request<void>({
      method: 'POST',
      path: '/open/v1/chats/notice',
      auth: 'user',
      body: input,
    });
  }

  /** 채팅 설정 조회. 스코프: 채팅 설정 조회 */
  async getSettings(): Promise<ChatSettings> {
    return this.http.request<ChatSettings>({
      method: 'GET',
      path: '/open/v1/chats/settings',
      auth: 'user',
    });
  }

  /** 채팅 설정 변경. 스코프: 채팅 설정 변경 */
  async updateSettings(input: UpdateChatSettingsInput): Promise<void> {
    if (
      input.minFollowerMinute !== undefined &&
      !ALLOWED_MIN_FOLLOWER_MINUTES.includes(input.minFollowerMinute)
    ) {
      throw new ChzzkValidationError(
        `minFollowerMinute 는 ${ALLOWED_MIN_FOLLOWER_MINUTES.join(', ')} 중 하나여야 합니다 (받은 값: ${input.minFollowerMinute}).`
      );
    }
    if (
      input.chatSlowModeSec !== undefined &&
      !ALLOWED_SLOW_MODE_SEC.includes(input.chatSlowModeSec)
    ) {
      throw new ChzzkValidationError(
        `chatSlowModeSec 는 ${ALLOWED_SLOW_MODE_SEC.join(', ')} 중 하나여야 합니다 (받은 값: ${input.chatSlowModeSec}).`
      );
    }

    await this.http.request<void>({
      method: 'PUT',
      path: '/open/v1/chats/settings',
      auth: 'user',
      body: input,
    });
  }

  /**
   * 메시지 숨기기(블라인드). 스코프: 채팅 메시지 쓰기
   *
   * 토큰 소유자가 해당 채널의 스트리머가 아니면 400 `스트리머가 아닙니다.` 를 반환합니다.
   */
  async blindMessage(input: BlindMessageInput): Promise<void> {
    await this.http.request<void>({
      method: 'POST',
      path: '/open/v1/chats/blind-message',
      auth: 'user',
      body: input,
    });
  }
}

function assertMessageLength(message: string): void {
  if (message.length === 0) {
    throw new ChzzkValidationError('빈 메시지는 전송할 수 없습니다.');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new ChzzkValidationError(
      `메시지는 최대 ${MAX_MESSAGE_LENGTH}자입니다 (현재 ${message.length}자). splitMessage() 로 나눠 보내세요.`
    );
  }
}

/**
 * 100자 제한에 맞춰 메시지를 여러 조각으로 나눕니다.
 * 가능하면 공백 경계에서 끊고, 단어 하나가 제한을 넘으면 강제로 자릅니다.
 */
export function splitMessage(message: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (limit < 1) throw new ChzzkValidationError('limit 은 1 이상이어야 합니다.');

  const chunks: string[] = [];
  let rest = message.trim();

  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    const cut = window.lastIndexOf(' ');
    const at = cut > 0 ? cut : limit;
    chunks.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0) chunks.push(rest);

  return chunks;
}
