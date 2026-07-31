import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { ConfigSource } from '../ports.js';
import type { BotConfig, CustomCommand } from '@chzzk-bot/contracts';
import { CooldownTracker } from './cooldown.js';
import { hasRole, isAdmin } from './permissions.js';

/** 목록형 명령의 하위 동작. `!멤버 추가 홍길동` 처럼 씁니다. */
const ADD_KEYWORDS = new Set(['추가', 'add', '+']);
const REMOVE_KEYWORDS = new Set(['삭제', '제거', 'remove', 'del', '-']);
const CLEAR_KEYWORDS = new Set(['초기화', '비우기', 'clear', 'reset']);

/** 목록이 길어질 때 채팅창 도배를 막기 위한 상한 */
export const MAX_LIST_ITEMS_SHOWN = 30;

export interface CommandOutcome {
  /** 채팅으로 내보낼 문구. null 이면 아무것도 보내지 않습니다. */
  reply: string | null;
  /** 명령을 찾아 처리했는지 (자동응답으로 넘길지 판단하는 데 씁니다) */
  handled: boolean;
}

const NOT_HANDLED: CommandOutcome = { reply: null, handled: false };

/**
 * 사용자가 정의한 명령어를 실행합니다.
 *
 * 요청하신 `!멤버` 동작이 `list` 타입입니다.
 *   `!멤버 빅헤드,9구진`  → 목록을 통째로 교체 (수정 권한 필요)
 *   `!멤버 추가 홍길동`    → 한 명 추가
 *   `!멤버 삭제 빅헤드`    → 한 명 제거
 *   `!멤버`               → 저장된 목록 출력 (누구나)
 */
export class CustomCommandEngine {
  private readonly cooldowns = new CooldownTracker();

  constructor(private readonly store: ConfigSource) {}

  async execute(
    event: ChatEvent,
    config: BotConfig,
    commandName: string,
    args: string[],
    /** 구독자 전용 명령 판정. 구독자 목록을 못 받는 상태면 undefined 를 넘기세요. */
    isSubscriber?: (channelId: string) => boolean
  ): Promise<CommandOutcome> {
    const command = this.store.findCommand(commandName);
    if (!command || !command.enabled) return NOT_HANDLED;

    if (!hasRole(event, command.useRoles, config.permissions)) return NOT_HANDLED;

    // 구독자 전용은 관리자에게는 적용하지 않습니다. 스트리머가 자기 명령을 못 쓰면 곤란합니다.
    if (command.subscriberOnly && !isAdmin(event, config.permissions)) {
      if (!isSubscriber) {
        return { reply: '구독자 확인이 불가능해 이 명령을 사용할 수 없습니다.', handled: true };
      }
      if (!isSubscriber(event.senderChannelId)) {
        return { reply: `${command.name} 은(는) 구독자 전용입니다.`, handled: true };
      }
    }

    const canEdit = hasRole(event, command.editRoles, config.permissions);
    const wantsEdit = args.length > 0 && command.type !== 'text';

    // 수정 시도는 쿨다운을 적용하지 않습니다. 관리 동작이 조용히 씹히면 혼란스럽습니다.
    if (wantsEdit) {
      if (!canEdit) {
        return {
          reply: `${command.name} 명령은 스트리머·매니저만 수정할 수 있습니다.`,
          handled: true,
        };
      }
      return this.edit(command, args);
    }

    const cooldownKey = `${command.id}:${event.senderChannelId}`;
    if (!this.cooldowns.tryUse(cooldownKey, command.cooldownSec)) {
      return { reply: null, handled: true };
    }

    return this.read(event, command);
  }

  // ─── 조회 ──────────────────────────────────────────────────────────────────

  private async read(event: ChatEvent, command: CustomCommand): Promise<CommandOutcome> {
    const counterValue = await this.store.bumpCommandUsage(
      command.id,
      command.type === 'counter' ? 1 : 0
    );

    if (command.type === 'list' && command.items.length === 0) {
      return {
        reply: `아직 등록된 ${command.name} 목록이 없습니다. "!${command.name} 이름1,이름2" 로 등록하세요.`,
        handled: true,
      };
    }

    return { reply: render(command, event, counterValue), handled: true };
  }

  // ─── 수정 ──────────────────────────────────────────────────────────────────

  private async edit(command: CustomCommand, args: string[]): Promise<CommandOutcome> {
    if (command.type === 'counter') {
      return this.editCounter(command, args);
    }

    const [head, ...tail] = args;
    const keyword = head?.toLowerCase() ?? '';

    if (CLEAR_KEYWORDS.has(keyword)) {
      await this.store.setCommandItems(command.id, []);
      return { reply: `${command.name} 목록을 비웠습니다.`, handled: true };
    }

    if (ADD_KEYWORDS.has(keyword)) {
      const added = parseItems(tail.join(' '));
      if (added.length === 0) {
        return {
          reply: `추가할 이름을 입력하세요. 예) !${command.name} 추가 홍길동`,
          handled: true,
        };
      }
      // 중복은 조용히 걸러냅니다.
      const next = dedupe([...command.items, ...added]);
      await this.store.setCommandItems(command.id, next);
      return {
        reply: `${command.name}에 ${added.join(', ')} 추가 (총 ${next.length}명)`,
        handled: true,
      };
    }

    if (REMOVE_KEYWORDS.has(keyword)) {
      const targets = parseItems(tail.join(' '));
      if (targets.length === 0) {
        return {
          reply: `삭제할 이름을 입력하세요. 예) !${command.name} 삭제 홍길동`,
          handled: true,
        };
      }
      const lowered = new Set(targets.map((t) => t.toLowerCase()));
      const next = command.items.filter((item) => !lowered.has(item.toLowerCase()));
      const removedCount = command.items.length - next.length;

      if (removedCount === 0) {
        return {
          reply: `${command.name} 목록에 ${targets.join(', ')} 이(가) 없습니다.`,
          handled: true,
        };
      }
      await this.store.setCommandItems(command.id, next);
      return {
        reply: `${command.name}에서 ${removedCount}명 삭제 (총 ${next.length}명)`,
        handled: true,
      };
    }

    // 하위 명령이 아니면 목록 전체를 교체합니다. — `!멤버 빅헤드,9구진`
    const items = dedupe(parseItems(args.join(' ')));
    if (items.length === 0) {
      return {
        reply: `등록할 이름을 입력하세요. 예) !${command.name} 빅헤드,9구진`,
        handled: true,
      };
    }

    await this.store.setCommandItems(command.id, items);
    return {
      reply: `${command.name} 목록을 등록했습니다 (${items.length}명): ${items.join(', ')}`,
      handled: true,
    };
  }

  private async editCounter(command: CustomCommand, args: string[]): Promise<CommandOutcome> {
    const [head] = args;
    if (head && CLEAR_KEYWORDS.has(head.toLowerCase())) {
      await this.store.upsertCommand({ id: command.id, name: command.name, count: 0 });
      return { reply: `${command.name} 카운터를 0으로 초기화했습니다.`, handled: true };
    }

    const value = Number(head);
    if (!Number.isFinite(value) || value < 0) {
      return { reply: `숫자를 입력하세요. 예) !${command.name} 10`, handled: true };
    }

    await this.store.upsertCommand({
      id: command.id,
      name: command.name,
      count: Math.floor(value),
    });
    return {
      reply: `${command.name} 카운터를 ${Math.floor(value)}(으)로 설정했습니다.`,
      handled: true,
    };
  }
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/**
 * `빅헤드,9구진` / `빅헤드, 9구진` / `빅헤드 9구진` 을 모두 받아냅니다.
 * 쉼표가 하나라도 있으면 쉼표 기준으로만 나눕니다 — 이름에 공백이 들어갈 수 있기 때문입니다.
 */
export function parseItems(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text.includes(',') ? text.split(',') : text.split(/\s+/);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 응답 템플릿의 치환자를 채웁니다. */
export function render(command: CustomCommand, event: ChatEvent, counterValue = 0): string {
  const shown = command.items.slice(0, MAX_LIST_ITEMS_SHOWN);
  const overflow = command.items.length - shown.length;
  const value =
    command.type === 'list'
      ? shown.join(', ') + (overflow > 0 ? ` 외 ${overflow}명` : '')
      : String(counterValue);

  const template =
    command.response ||
    (command.type === 'list' ? `${command.name}: {value}` : `${command.name}: {count}`);

  return template
    .replaceAll('{user}', event.profile?.nickname ?? '')
    .replaceAll('{value}', value)
    .replaceAll('{n}', String(command.items.length))
    .replaceAll('{count}', String(counterValue));
}

/** 관리자용 안내에 쓰는, 이 사람이 쓸 수 있는 명령 목록 */
export function visibleCommandNames(config: BotConfig, event: ChatEvent, prefix: string): string[] {
  return config.commands
    .filter((c) => c.enabled)
    .filter(
      (c) => hasRole(event, c.useRoles, config.permissions) || isAdmin(event, config.permissions)
    )
    .map((c) => `${prefix}${c.name}`);
}
