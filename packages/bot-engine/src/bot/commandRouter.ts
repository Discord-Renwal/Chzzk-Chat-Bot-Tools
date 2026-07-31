import type { ChatEvent, UserRoleCode } from '@chzzk-bot/chzzk-sdk';

/** 명령 핸들러에 전달되는 실행 문맥 */
export interface CommandContext {
  /** 원본 채팅 이벤트 */
  event: ChatEvent;
  /** 접두사와 명령어를 제외한 인자 목록 */
  args: string[];
  /** 인자 전체를 한 문자열로 */
  rest: string;
  /** 답장 전송 (100자 초과 시 자동으로 나눠 보냅니다) */
  reply: (message: string) => Promise<void>;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description?: string;
  /** 이 역할에 해당하는 사용자만 실행할 수 있습니다. 비우면 누구나 가능. */
  allowedRoles?: UserRoleCode[];
  /** 사용자별 재사용 대기 시간(ms) */
  cooldownMs?: number;
  handler: (ctx: CommandContext) => Promise<void> | void;
}

export interface CommandRouterOptions {
  prefix?: string;
  /** 봇 자신의 channelId — 자기 메시지에 반응해 무한 루프에 빠지는 걸 막습니다. */
  botChannelId?: string;
  onError?: (error: unknown, event: ChatEvent) => void;
}

/**
 * 채팅 명령 라우터. 접두사, 별칭, 권한, 쿨다운을 처리합니다.
 *
 * 봇이 보낸 메시지도 CHAT 이벤트로 되돌아오므로 `botChannelId` 를 꼭 넘겨 주세요.
 * 넘기지 않으면 봇이 자기 출력에 반응해 무한 루프를 돌 수 있습니다.
 */
export class CommandRouter {
  private readonly commands = new Map<string, CommandDefinition>();
  private readonly prefix: string;
  private readonly cooldowns = new Map<string, number>();

  constructor(private readonly options: CommandRouterOptions = {}) {
    this.prefix = options.prefix ?? '!';
  }

  register(command: CommandDefinition): this {
    for (const key of [command.name, ...(command.aliases ?? [])]) {
      this.commands.set(key.toLowerCase(), command);
    }
    return this;
  }

  /** 등록된 명령 목록 (별칭 제외, 중복 제거) */
  list(): CommandDefinition[] {
    return [...new Set(this.commands.values())];
  }

  /**
   * 채팅 이벤트를 처리합니다.
   * @returns 명령이 실행되었으면 true
   */
  async handle(event: ChatEvent, reply: (message: string) => Promise<void>): Promise<boolean> {
    if (this.options.botChannelId && event.senderChannelId === this.options.botChannelId) {
      return false;
    }

    const content = event.content?.trim() ?? '';
    if (!content.startsWith(this.prefix)) return false;

    const [rawName, ...args] = content.slice(this.prefix.length).trim().split(/\s+/);
    if (!rawName) return false;

    const command = this.commands.get(rawName.toLowerCase());
    if (!command) return false;

    if (command.allowedRoles && !command.allowedRoles.includes(event.userRoleCode)) {
      return false;
    }

    if (command.cooldownMs) {
      const key = `${command.name}:${event.senderChannelId}`;
      const readyAt = this.cooldowns.get(key) ?? 0;
      const now = Date.now();
      if (now < readyAt) return false;
      this.cooldowns.set(key, now + command.cooldownMs);
    }

    try {
      await command.handler({ event, args, rest: args.join(' '), reply });
      return true;
    } catch (error) {
      if (this.options.onError) this.options.onError(error, event);
      else console.error(`[command:${command.name}] 실행 중 오류`, error);
      return true;
    }
  }
}
