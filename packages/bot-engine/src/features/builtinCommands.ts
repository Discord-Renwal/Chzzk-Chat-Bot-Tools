import type { ChzzkClient } from '@chzzk-bot/chzzk-sdk';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';
import type { BotConfig } from '@chzzk-bot/contracts';
import type { ViewerStore } from '../ports.js';
import type { SongStore } from '../ports.js';
import type { EventSink } from '../ports.js';
import type { ChatterIndex } from './chatterIndex.js';
import { formatPoints } from './points.js';
import { hasRole } from './permissions.js';
import { ChzzkApiError } from '@chzzk-bot/chzzk-sdk';

export interface BuiltinContext {
  event: ChatEvent;
  config: BotConfig;
  args: string[];
  rest: string;
  isAdmin: boolean;
  chzzk: ChzzkClient;
  users: ViewerStore;
  songs: SongStore;
  chatters: ChatterIndex;
  log: EventSink;
}

export interface BuiltinCommand {
  names: string[];
  /** 도움말에 보여줄 사용법 */
  usage: string;
  description: string;
  adminOnly?: boolean;
  /** null 을 돌려주면 아무 말도 하지 않습니다. */
  run: (ctx: BuiltinContext) => Promise<string | null> | string | null;
}

const KST = { timeZone: 'Asia/Seoul' } as const;

// ─── 포인트 ───────────────────────────────────────────────────────────────────

const points: BuiltinCommand = {
  names: ['포인트', '내포인트', 'point', 'points'],
  usage: '!포인트',
  description: '내 포인트와 순위를 봅니다.',
  run: ({ event, config, users }) => {
    if (!config.points.enabled) return null;

    const unit = config.points.unitName;
    const me = users.get(event.senderChannelId);
    const nickname = event.profile?.nickname ?? '';

    if (!me || me.points === 0) {
      return `${nickname}님의 ${unit}는 0${unit} 입니다. 채팅하시면 쌓여요!`;
    }
    const rank = users.rankOf(event.senderChannelId);
    return `${nickname}님: ${formatPoints(me.points)}${unit}${rank ? ` (${rank}위)` : ''} · 채팅 ${formatPoints(me.chatCount)}회`;
  },
};

const attendance: BuiltinCommand = {
  names: ['출석', '출첵', 'attend'],
  usage: '!출석',
  description: '하루 한 번 출석해 포인트를 받습니다.',
  run: ({ event, config, users }) => {
    if (!config.points.enabled || !config.points.attendance.enabled) return null;

    const { reward, streakBonus, maxStreakBonus } = config.points.attendance;
    const unit = config.points.unitName;
    const nickname = event.profile?.nickname ?? '';

    const result = users.checkAttendance(
      event.senderChannelId,
      nickname,
      reward,
      streakBonus,
      maxStreakBonus
    );

    if (!result.checked) {
      return `${nickname}님은 오늘 이미 출석하셨습니다. (연속 ${result.streak}일)`;
    }
    const total = users.get(event.senderChannelId)?.points ?? 0;
    return `${nickname}님 출석 완료! +${formatPoints(result.reward)}${unit} (연속 ${result.streak}일 · 총 ${formatPoints(total)}${unit})`;
  },
};

const ranking: BuiltinCommand = {
  names: ['랭킹', '순위', 'rank', 'top'],
  usage: '!랭킹',
  description: '포인트 상위 5명을 봅니다.',
  run: ({ config, users }) => {
    if (!config.points.enabled) return null;

    const top = users.topByPoints(5);
    if (top.length === 0) return '아직 순위에 오른 사람이 없습니다.';

    const unit = config.points.unitName;
    const line = top
      .map((u, i) => `${i + 1}.${u.nickname || '익명'} ${formatPoints(u.points)}`)
      .join(' · ');
    return `${unit} 랭킹 — ${line}`;
  },
};

const givePoints: BuiltinCommand = {
  names: ['지급', '포인트지급'],
  usage: '!지급 <닉네임> <수량>',
  description: '포인트를 지급합니다.',
  adminOnly: true,
  run: ({ args, config, users, chatters }) => {
    const [nickname, amountRaw] = args;
    const amount = Number(amountRaw);
    if (!nickname || !Number.isFinite(amount) || amount === 0) {
      return '사용법: !지급 <닉네임> <수량>';
    }

    // 포인트 지급은 되돌릴 수 있어 앞부분 일치를 허용합니다.
    const target = chatters.find(nickname, { allowPrefix: true });
    if (!target) {
      return `"${nickname}" 님을 찾지 못했습니다. 최근에 채팅한 사람만 지정할 수 있습니다.`;
    }

    const total = users.addPoints(target.channelId, target.nickname, Math.floor(amount));
    const unit = config.points.unitName;
    const verb = amount > 0 ? '지급' : '회수';
    return `${target.nickname}님에게 ${formatPoints(Math.abs(Math.floor(amount)))}${unit} ${verb} (보유 ${formatPoints(total)}${unit})`;
  },
};

// ─── 신청곡 ───────────────────────────────────────────────────────────────────

const requestSong: BuiltinCommand = {
  names: ['신청곡', '신청', 'sr'],
  usage: '!신청곡 <제목>',
  description: '노래를 신청합니다.',
  run: ({ event, config, users, songs, log }) => {
    const settings = config.songs;
    if (!settings.enabled) return null;

    if (!hasRole(event, settings.allowedRoles, config.permissions)) {
      return '신청곡을 요청할 권한이 없습니다.';
    }

    const title = event.content.split(/\s+/).slice(1).join(' ').trim();
    if (!title) return '사용법: !신청곡 <노래 제목>';
    if (title.length > 100) return '제목이 너무 깁니다. 100자 이내로 입력해 주세요.';

    const nickname = event.profile?.nickname ?? '';

    if (songs.pending().length >= settings.maxQueueSize) {
      return `대기열이 가득 찼습니다. (최대 ${settings.maxQueueSize}곡)`;
    }
    if (songs.pendingCountBy(event.senderChannelId) >= settings.maxPerUser) {
      return `${nickname}님은 이미 ${settings.maxPerUser}곡을 신청하셨습니다.`;
    }
    if (!settings.allowDuplicate && songs.hasPendingTitle(title)) {
      return `"${title}" 은(는) 이미 대기열에 있습니다.`;
    }

    // 포인트를 먼저 차감하고, 실패하면 신청 자체를 막습니다.
    if (settings.cost > 0) {
      if (!config.points.enabled) return '포인트 기능이 꺼져 있어 신청곡을 받을 수 없습니다.';
      if (!users.spendPoints(event.senderChannelId, settings.cost)) {
        const have = users.get(event.senderChannelId)?.points ?? 0;
        return `${config.points.unitName}가 부족합니다. (필요 ${formatPoints(settings.cost)} · 보유 ${formatPoints(have)})`;
      }
    }

    const song = songs.add({
      title,
      requesterChannelId: event.senderChannelId,
      requesterNickname: nickname,
      pointsSpent: settings.cost,
    });
    log.push('song', `신청곡 추가: ${title}`, { actor: nickname });

    const position = songs.pending().length;
    return `${nickname}님의 "${song.title}" 접수! (대기 ${position}번째)`;
  },
};

const songList: BuiltinCommand = {
  names: ['신청목록', '대기열', 'queue'],
  usage: '!신청목록',
  description: '대기 중인 신청곡을 봅니다.',
  run: ({ config, songs }) => {
    if (!config.songs.enabled) return null;

    const playing = songs.playing();
    const pending = songs.pending();
    if (!playing && pending.length === 0) return '대기 중인 신청곡이 없습니다.';

    // 채팅 100자 제한이 있어 앞 3곡만 보여주고 나머지는 개수로 줄입니다.
    const head = pending.slice(0, 3).map((s, i) => `${i + 1}.${s.title}`);
    const more = pending.length > 3 ? ` 외 ${pending.length - 3}곡` : '';
    const now = playing ? `▶ ${playing.title} / ` : '';
    return `${now}${head.join(' · ')}${more}` || '대기 중인 신청곡이 없습니다.';
  },
};

const cancelSong: BuiltinCommand = {
  names: ['신청취소', '취소'],
  usage: '!신청취소',
  description: '내가 신청한 곡을 취소합니다.',
  run: ({ event, config, songs, users }) => {
    if (!config.songs.enabled) return null;

    const removed = songs.cancelOwn(event.senderChannelId);
    if (!removed) return '취소할 신청곡이 없습니다.';

    // 포인트를 냈다면 돌려줍니다.
    if (removed.pointsSpent > 0) {
      users.addPoints(event.senderChannelId, event.profile?.nickname ?? '', removed.pointsSpent);
    }
    return `"${removed.title}" 신청을 취소했습니다.`;
  },
};

const nextSong: BuiltinCommand = {
  names: ['다음곡', 'next'],
  usage: '!다음곡',
  description: '다음 곡을 재생 상태로 넘깁니다.',
  adminOnly: true,
  run: ({ config, songs, log }) => {
    if (!config.songs.enabled) return null;

    const started = songs.next();
    if (!started) return '대기 중인 신청곡이 없습니다.';
    log.push('song', `재생 시작: ${started.title}`);
    return `▶ ${started.title} (${started.requesterNickname}님 신청)`;
  },
};

const skipSong: BuiltinCommand = {
  names: ['스킵', 'skip'],
  usage: '!스킵',
  description: '현재 곡을 건너뜁니다.',
  adminOnly: true,
  run: ({ config, songs, log }) => {
    if (!config.songs.enabled) return null;

    const skipped = songs.skip();
    if (!skipped) return '건너뛸 곡이 없습니다.';
    log.push('song', `건너뜀: ${skipped.title}`);
    return `"${skipped.title}" 을(를) 건너뛰었습니다.`;
  },
};

// ─── 방송 관리 ────────────────────────────────────────────────────────────────

const setTitle: BuiltinCommand = {
  names: ['제목', '방제', '방제변경', 'title'],
  usage: '!제목 <새 제목>',
  description: '방송 제목을 바꿉니다.',
  adminOnly: true,
  run: async ({ event, chzzk, log }) => {
    const title = event.content.split(/\s+/).slice(1).join(' ').trim();
    if (!title) return '사용법: !제목 <새 방송 제목>';

    try {
      await chzzk.lives.updateSetting({ defaultLiveTitle: title });
      log.push('system', `방송 제목 변경: ${title}`, { actor: event.profile?.nickname });
      return `방송 제목을 "${title}" 로 바꿨습니다.`;
    } catch (error) {
      return describeApiError(error, '제목 변경');
    }
  },
};

const setCategory: BuiltinCommand = {
  names: ['카테고리', '게임', '게임변경', 'category', 'game'],
  usage: '!카테고리 <검색어>',
  description: '방송 카테고리를 바꿉니다.',
  adminOnly: true,
  run: async ({ event, chzzk, log }) => {
    const query = event.content.split(/\s+/).slice(1).join(' ').trim();
    if (!query) return '사용법: !카테고리 <검색어>';

    try {
      const found = await chzzk.categories.search(query, { size: 1 });
      const category = found[0];
      if (!category) return `"${query}" 에 맞는 카테고리를 찾지 못했습니다.`;

      await chzzk.lives.updateSetting({
        categoryType: category.categoryType,
        categoryId: category.categoryId,
      });
      log.push('system', `카테고리 변경: ${category.categoryValue}`, {
        actor: event.profile?.nickname,
      });
      return `카테고리를 "${category.categoryValue}" 로 바꿨습니다.`;
    } catch (error) {
      return describeApiError(error, '카테고리 변경');
    }
  },
};

const setSlowMode: BuiltinCommand = {
  names: ['슬로우', 'slow'],
  usage: '!슬로우 <초>',
  description: '슬로우 모드를 설정합니다. (0=해제)',
  adminOnly: true,
  run: async ({ args, chzzk, log }) => {
    const seconds = Number(args[0]);
    // 문서가 정한 허용값 외에는 API 가 거절하므로 미리 걸러 안내합니다.
    const allowed = [0, 3, 5, 10, 30, 60, 120, 300];
    if (!allowed.includes(seconds)) {
      return `사용 가능한 값: ${allowed.join(', ')} (초)`;
    }

    try {
      await chzzk.chat.updateSettings({ chatSlowModeSec: seconds as 0 });
      log.push('system', `슬로우 모드 ${seconds}초`);
      return seconds === 0
        ? '슬로우 모드를 해제했습니다.'
        : `슬로우 모드 ${seconds}초로 설정했습니다.`;
    } catch (error) {
      return describeApiError(error, '슬로우 모드 변경');
    }
  },
};

const setNotice: BuiltinCommand = {
  names: ['공지', 'notice'],
  usage: '!공지 <내용>',
  description: '채팅 공지를 등록합니다.',
  adminOnly: true,
  run: async ({ event, chzzk, log }) => {
    const message = event.content.split(/\s+/).slice(1).join(' ').trim();
    if (!message) return '사용법: !공지 <내용>';
    if (message.length > 100) return `공지는 100자까지입니다. (현재 ${message.length}자)`;

    try {
      await chzzk.chat.setNotice({ message });
      log.push('system', `공지 등록: ${message}`, { actor: event.profile?.nickname });
      return '공지를 등록했습니다.';
    } catch (error) {
      return describeApiError(error, '공지 등록');
    }
  },
};

const timeoutUser: BuiltinCommand = {
  names: ['타임아웃', '임시제한'],
  usage: '!타임아웃 <닉네임>',
  description: '임시 제한을 겁니다.',
  adminOnly: true,
  run: async ({ event, args, chzzk, chatters, log }) => {
    const nickname = args[0];
    if (!nickname) return '사용법: !타임아웃 <닉네임>';

    const target = chatters.find(nickname);
    if (!target)
      return `"${nickname}" 님을 찾지 못했습니다. 최근 채팅한 사람만 지정할 수 있습니다.`;

    try {
      await chzzk.restrictions.temporaryRestrict({
        targetChannelId: target.channelId,
        chatChannelId: event.chatChannelId,
      });
      log.push('moderation', `임시 제한: ${target.nickname}`, { actor: event.profile?.nickname });
      return `${target.nickname}님을 임시 제한했습니다.`;
    } catch (error) {
      return describeApiError(error, '임시 제한');
    }
  },
};

const banUser: BuiltinCommand = {
  names: ['밴', '차단'],
  usage: '!밴 <닉네임>',
  description: '활동을 제한합니다.',
  adminOnly: true,
  run: async ({ args, chzzk, chatters, log, event }) => {
    const nickname = args[0];
    if (!nickname) return '사용법: !밴 <닉네임>';

    const target = chatters.find(nickname);
    if (!target)
      return `"${nickname}" 님을 찾지 못했습니다. 최근 채팅한 사람만 지정할 수 있습니다.`;

    try {
      await chzzk.restrictions.restrict(target.channelId);
      log.push('moderation', `활동 제한: ${target.nickname}`, { actor: event.profile?.nickname });
      return `${target.nickname}님의 활동을 제한했습니다.`;
    } catch (error) {
      return describeApiError(error, '활동 제한');
    }
  },
};

const unbanUser: BuiltinCommand = {
  names: ['밴해제', '차단해제', 'unban'],
  usage: '!밴해제 <닉네임>',
  description: '활동 제한을 풉니다.',
  adminOnly: true,
  run: async ({ args, chzzk, chatters, log, event }) => {
    const nickname = args[0];
    if (!nickname) return '사용법: !밴해제 <닉네임>';

    const target = chatters.find(nickname);
    if (!target) {
      // 제한당한 사람은 채팅을 못 하니 색인에 없을 수 있습니다.
      return `"${nickname}" 님을 찾지 못했습니다. 대시보드의 제재 관리에서 해제하세요.`;
    }

    try {
      await chzzk.restrictions.unrestrict(target.channelId);
      log.push('moderation', `활동 제한 해제: ${target.nickname}`, {
        actor: event.profile?.nickname,
      });
      return `${target.nickname}님의 활동 제한을 해제했습니다.`;
    } catch (error) {
      return describeApiError(error, '활동 제한 해제');
    }
  },
};

const untimeoutUser: BuiltinCommand = {
  names: ['타임아웃해제', '임시제한해제'],
  usage: '!타임아웃해제 <닉네임>',
  description: '임시 제한을 풉니다.',
  adminOnly: true,
  run: async ({ event, args, chzzk, chatters, log }) => {
    const nickname = args[0];
    if (!nickname) return '사용법: !타임아웃해제 <닉네임>';

    const target = chatters.find(nickname);
    if (!target) return `"${nickname}" 님을 찾지 못했습니다. 대시보드에서 해제하세요.`;

    try {
      await chzzk.restrictions.temporaryUnrestrict({
        targetChannelId: target.channelId,
        chatChannelId: event.chatChannelId,
      });
      log.push('moderation', `임시 제한 해제: ${target.nickname}`, {
        actor: event.profile?.nickname,
      });
      return `${target.nickname}님의 임시 제한을 해제했습니다.`;
    } catch (error) {
      return describeApiError(error, '임시 제한 해제');
    }
  },
};

/** 채팅 참여 대상을 한 번에 바꿉니다. 방송 중 난입 대응에 씁니다. */
const chatMode: BuiltinCommand = {
  names: ['채팅모드', 'chatmode'],
  usage: '!채팅모드 <전체|팔로워|구독자|매니저>',
  description: '채팅할 수 있는 대상을 바꿉니다.',
  adminOnly: true,
  run: async ({ args, chzzk, log, event }) => {
    const map: Record<string, 'ALL' | 'FOLLOWER' | 'SUBSCRIBER' | 'MANAGER'> = {
      전체: 'ALL',
      all: 'ALL',
      팔로워: 'FOLLOWER',
      follower: 'FOLLOWER',
      구독자: 'SUBSCRIBER',
      subscriber: 'SUBSCRIBER',
      매니저: 'MANAGER',
      manager: 'MANAGER',
    };

    const group = map[(args[0] ?? '').toLowerCase()];
    if (!group) return '사용법: !채팅모드 <전체|팔로워|구독자|매니저>';

    try {
      await chzzk.chat.updateSettings({ chatAvailableGroup: group });
      log.push('system', `채팅 모드 → ${group}`, { actor: event.profile?.nickname });
      const label = { ALL: '전체', FOLLOWER: '팔로워', SUBSCRIBER: '구독자', MANAGER: '매니저' }[
        group
      ];
      return `채팅 참여 대상을 "${label}" 로 바꿨습니다.`;
    } catch (error) {
      return describeApiError(error, '채팅 모드 변경');
    }
  },
};

const followerCount: BuiltinCommand = {
  names: ['팔로워', 'follower', 'followers'],
  usage: '!팔로워',
  description: '팔로워 수를 알려줍니다.',
  run: async ({ chzzk, config: _config, event }) => {
    try {
      const channel = await chzzk.channels.get(event.channelId);
      if (!channel) return null;
      return `${channel.channelName} 채널 팔로워 ${channel.followerCount.toLocaleString('ko-KR')}명`;
    } catch {
      return null;
    }
  },
};

// ─── 정보 ─────────────────────────────────────────────────────────────────────

const uptime: BuiltinCommand = {
  names: ['시간', 'time'],
  usage: '!시간',
  description: '현재 시각을 알려줍니다.',
  run: () => `지금은 ${new Date().toLocaleString('ko-KR', KST)} 입니다.`,
};

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  points,
  attendance,
  ranking,
  givePoints,
  requestSong,
  songList,
  cancelSong,
  nextSong,
  skipSong,
  setTitle,
  setCategory,
  setSlowMode,
  setNotice,
  timeoutUser,
  banUser,
  unbanUser,
  untimeoutUser,
  chatMode,
  followerCount,
  uptime,
];

/** 이름/별칭으로 내장 명령을 찾습니다. */
export function findBuiltin(name: string): BuiltinCommand | undefined {
  const key = name.toLowerCase();
  return BUILTIN_COMMANDS.find((command) => command.names.some((n) => n.toLowerCase() === key));
}

/**
 * API 오류를 채팅에 그대로 뱉으면 시청자에게 의미가 없습니다.
 * 자주 나오는 경우만 사람 말로 바꿔줍니다.
 */
function describeApiError(error: unknown, action: string): string {
  if (error instanceof ChzzkApiError) {
    if (error.code === 403) return `${action} 권한이 없습니다.`;
    if (error.isRateLimited) return `요청이 많아 잠시 후 다시 시도해 주세요.`;
    // 400 은 "스트리머가 아닙니다" 처럼 서버 문구가 그대로 쓸 만합니다.
    if (error.code === 400) return `${action} 실패: ${error.message.split('—').pop()?.trim()}`;
  }
  return `${action}에 실패했습니다.`;
}
