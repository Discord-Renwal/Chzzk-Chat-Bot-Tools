import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonViewerStore, kstDate } from '../src/state/userStore.js';
import { JsonSongStore } from '../src/state/songQueue.js';
import { EventLog } from '../src/state/eventLog.js';
import { SpamFilter, hasRepeatedRun, containsBlockedLink } from '../src/features/spamFilter.js';
import { Moderator } from '../src/features/moderation.js';
import { GameEngine } from '../src/features/games.js';
import { PointEngine } from '../src/features/points.js';
import { ChatterIndex } from '../src/features/chatterIndex.js';
import { expandVariables, pickRandomVariant } from '../src/features/variables.js';
import type { ChannelContext } from '../src/features/variables.js';
import { botConfig, spamSettings } from '@chzzk-bot/contracts';
import type { ChatEvent } from '@chzzk-bot/chzzk-sdk';

let dir: string;

function chat(content: string, overrides: Partial<ChatEvent> = {}): ChatEvent {
  return {
    channelId: 'ch',
    senderChannelId: 'viewer-1',
    chatChannelId: 'chat',
    profile: { nickname: '홍길동', badges: [], verifiedMark: false },
    userRoleCode: 'common_user',
    content,
    emojis: {},
    messageTime: Date.now(),
    ...overrides,
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chzzk-feat-'));
});
afterEach(async () => {
  // 저장은 비동기라 테스트가 끝난 직후에도 쓰기가 진행 중일 수 있습니다.
  // 윈도우에서는 그 상태로 지우면 ENOTEMPTY 가 나므로 잠깐 재시도합니다.
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

// ─── 포인트 / 출석 ────────────────────────────────────────────────────────────

describe('JsonViewerStore', () => {
  async function store() {
    return JsonViewerStore.open(join(dir, 'users.json'));
  }

  it('채팅으로 포인트가 쌓이고 파일에 남는다', async () => {
    const users = await store();
    users.recordChat('u1', '길동', 10);
    users.recordChat('u1', '길동', 10);
    await users.flush();

    expect(users.get('u1')?.points).toBe(20);
    expect(users.get('u1')?.chatCount).toBe(2);

    const reopened = await JsonViewerStore.open(join(dir, 'users.json'));
    expect(reopened.get('u1')?.points).toBe(20);
  });

  it('포인트는 0 아래로 내려가지 않는다', async () => {
    const users = await store();
    users.addPoints('u1', '길동', 50);
    expect(users.addPoints('u1', '길동', -200)).toBe(0);
  });

  it('잔액이 부족하면 차감하지 않는다', async () => {
    const users = await store();
    users.addPoints('u1', '길동', 50);

    expect(users.spendPoints('u1', 100)).toBe(false);
    expect(users.get('u1')?.points).toBe(50);
    expect(users.spendPoints('u1', 30)).toBe(true);
    expect(users.get('u1')?.points).toBe(20);
  });

  it('출석은 하루 한 번만 인정된다', async () => {
    const users = await store();
    const first = users.checkAttendance('u1', '길동', 100, 20, 200);
    const second = users.checkAttendance('u1', '길동', 100, 20, 200);

    expect(first).toMatchObject({ checked: true, streak: 1, reward: 100 });
    expect(second.checked).toBe(false);
    expect(users.get('u1')?.points).toBe(100);
  });

  it('연속 출석이면 스트릭과 보너스가 늘어난다', async () => {
    const users = await store();
    // 어제 출석한 상태를 만들어 둡니다.
    users.checkAttendance('u1', '길동', 100, 20, 200);
    const yesterday = kstDate(Date.now() - 24 * 60 * 60 * 1000);
    (users as unknown as { file: { update: (fn: (d: never) => void) => void } }).file.update(
      (draft) => {
        const record = (
          draft as unknown as { users: Record<string, { lastAttendanceDate: string }> }
        ).users['u1'];
        if (record) record.lastAttendanceDate = yesterday;
      }
    );

    const next = users.checkAttendance('u1', '길동', 100, 20, 200);
    expect(next).toMatchObject({ checked: true, streak: 2, reward: 120 });
  });

  it('랭킹은 포인트 순으로 나온다', async () => {
    const users = await store();
    users.addPoints('a', 'A', 300);
    users.addPoints('b', 'B', 100);
    users.addPoints('c', 'C', 200);

    expect(users.topByPoints(3).map((u) => u.nickname)).toEqual(['A', 'C', 'B']);
    expect(users.rankOf('c')).toBe(2);
  });
});

describe('PointEngine', () => {
  it('쿨다운 중에는 적립하지 않는다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    const engine = new PointEngine(users);
    const settings = botConfig.parse({}).points;

    expect(engine.onChat('u1', '길동', settings)).toBe(settings.perChat);
    expect(engine.onChat('u1', '길동', settings)).toBe(0);
    // 적립은 안 돼도 채팅 수는 세야 합니다.
    expect(users.get('u1')?.chatCount).toBe(2);
  });

  it('후원 금액에 비례해 적립한다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    const engine = new PointEngine(users);
    const settings = botConfig.parse({}).points; // 1000원당 100

    expect(engine.onDonation('u1', '길동', '5000', settings)).toBe(500);
    // 문자열에 콤마가 섞여 와도 처리합니다.
    expect(engine.onDonation('u2', '철수', '1,000', settings)).toBe(100);
  });
});

// ─── 신청곡 ───────────────────────────────────────────────────────────────────

describe('JsonSongStore', () => {
  async function queue() {
    return JsonSongStore.open(join(dir, 'songs.json'));
  }

  it('추가하고 순서대로 재생한다', async () => {
    const songs = await queue();
    songs.add({ title: 'A', requesterChannelId: 'u1', requesterNickname: '길동' });
    songs.add({ title: 'B', requesterChannelId: 'u2', requesterNickname: '철수' });

    expect(songs.pending().map((s) => s.title)).toEqual(['A', 'B']);

    const started = songs.next();
    expect(started?.title).toBe('A');
    expect(songs.playing()?.title).toBe('A');
    expect(songs.pending().map((s) => s.title)).toEqual(['B']);
  });

  it('중복 제목을 감지한다', async () => {
    const songs = await queue();
    songs.add({ title: '밤편지', requesterChannelId: 'u1', requesterNickname: '길동' });
    expect(songs.hasPendingTitle(' 밤편지 ')).toBe(true);
    expect(songs.hasPendingTitle('다른곡')).toBe(false);
  });

  it('순서를 위아래로 옮긴다', async () => {
    const songs = await queue();
    songs.add({ title: 'A', requesterChannelId: 'u1', requesterNickname: '길동' });
    songs.add({ title: 'B', requesterChannelId: 'u2', requesterNickname: '철수' });

    const second = songs.pending()[1]!;
    expect(songs.move(second.id, 'up')).toBe(true);
    expect(songs.pending().map((s) => s.title)).toEqual(['B', 'A']);

    // 맨 위에서 더 올릴 수는 없습니다.
    expect(songs.move(second.id, 'up')).toBe(false);
  });

  it('본인 곡만 취소된다', async () => {
    const songs = await queue();
    songs.add({ title: 'A', requesterChannelId: 'u1', requesterNickname: '길동' });
    songs.add({ title: 'B', requesterChannelId: 'u2', requesterNickname: '철수' });

    expect(songs.cancelOwn('u2')?.title).toBe('B');
    expect(songs.cancelOwn('u3')).toBeNull();
    expect(songs.pending().map((s) => s.title)).toEqual(['A']);
  });

  it('1인당 대기 곡 수를 센다', async () => {
    const songs = await queue();
    songs.add({ title: 'A', requesterChannelId: 'u1', requesterNickname: '길동' });
    songs.add({ title: 'B', requesterChannelId: 'u1', requesterNickname: '길동' });
    expect(songs.pendingCountBy('u1')).toBe(2);
  });
});

// ─── 스팸 필터 ────────────────────────────────────────────────────────────────

describe('스팸 필터', () => {
  it('같은 문자 반복을 잡는다', () => {
    expect(hasRepeatedRun('ㅋㅋㅋㅋㅋㅋ', 5)).toBe(true);
    expect(hasRepeatedRun('ㅋㅋㅋ', 5)).toBe(false);
    expect(hasRepeatedRun('안녕하세요', 5)).toBe(false);
  });

  it('허용 목록 밖의 링크를 잡는다', () => {
    expect(containsBlockedLink('여기 봐 https://evil.com/x', [])).toBe(true);
    expect(containsBlockedLink('youtube.com/watch?v=1', ['youtube.com'])).toBe(false);
    expect(containsBlockedLink('www.youtube.com/watch', ['youtube.com'])).toBe(false);
    // 숫자만 있는 건 링크가 아닙니다.
    expect(containsBlockedLink('원주율은 3.14 입니다', [])).toBe(false);
  });

  it('위반이 쌓이면 임시제한 단계로 올라간다', () => {
    const filter = new SpamFilter();
    const settings = spamSettings.parse({
      enabled: true,
      maxRepeatedChars: 3,
      tempBanAfterViolations: 3,
    });

    const first = filter.inspect(chat('ㅋㅋㅋㅋㅋ'), settings);
    expect(first?.violations).toBe(1);
    expect(first?.escalateToTempBan).toBe(false);

    filter.inspect(chat('ㅎㅎㅎㅎㅎ'), settings);
    const third = filter.inspect(chat('ㅜㅜㅜㅜㅜ'), settings);
    expect(third?.violations).toBe(3);
    expect(third?.escalateToTempBan).toBe(true);
  });

  it('스트리머는 검사에서 제외된다', () => {
    const filter = new SpamFilter();
    const settings = spamSettings.parse({ enabled: true, maxRepeatedChars: 3 });
    expect(filter.inspect(chat('ㅋㅋㅋㅋㅋ', { userRoleCode: 'streamer' }), settings)).toBeNull();
  });

  it('같은 메시지 반복을 잡는다', () => {
    const filter = new SpamFilter();
    const settings = spamSettings.parse({ enabled: true, duplicateWindowSec: 30 });

    expect(filter.inspect(chat('안녕하세요'), settings)).toBeNull();
    expect(filter.inspect(chat('안녕하세요'), settings)?.reason).toBe('duplicate');
  });

  it('꺼져 있으면 아무것도 잡지 않는다', () => {
    const filter = new SpamFilter();
    const off = spamSettings.parse({ enabled: false, maxRepeatedChars: 1 });
    expect(filter.inspect(chat('ㅋㅋㅋㅋㅋㅋ'), off)).toBeNull();
  });
});

// ─── 미니게임 ─────────────────────────────────────────────────────────────────

describe('GameEngine', () => {
  const config = botConfig.parse({
    points: { enabled: true },
    games: { enabled: true, minBet: 10, maxBet: 1000, cooldownSec: 0 },
  });

  it('잔액이 부족하면 게임이 진행되지 않는다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 5);

    const engine = new GameEngine(users, () => 0);
    const result = engine.gamble('u1', '길동', '100', config.games, config.points);

    expect(result?.message).toContain('부족');
    expect(users.get('u1')?.points).toBe(5);
  });

  it('이기면 베팅액만큼 늘어난다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 1000);

    // random()=0 → 항상 승리
    const engine = new GameEngine(users, () => 0);
    const result = engine.gamble('u1', '길동', '100', config.games, config.points);

    expect(result?.delta).toBe(100);
    expect(users.get('u1')?.points).toBe(1100);
  });

  it('지면 베팅액을 잃는다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 1000);

    // random()=0.99 → 승률 45% 기준 패배
    const engine = new GameEngine(users, () => 0.99);
    const result = engine.gamble('u1', '길동', '100', config.games, config.points);

    expect(result?.delta).toBe(-100);
    expect(users.get('u1')?.points).toBe(900);
  });

  it('올인은 최대 베팅으로 상한이 걸린다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 999_999);

    const engine = new GameEngine(users, () => 0);
    const result = engine.gamble('u1', '길동', '올인', config.games, config.points);
    // maxBet=1000 이므로 그 이상은 걸리지 않습니다.
    expect(result?.delta).toBe(1000);
  });

  it('최소 베팅보다 적으면 거절한다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 1000);

    const engine = new GameEngine(users, () => 0);
    expect(engine.gamble('u1', '길동', '1', config.games, config.points)?.message).toContain(
      '최소'
    );
  });
});

// ─── 변수 ─────────────────────────────────────────────────────────────────────

describe('변수 치환', () => {
  it('$변수 와 {변수} 를 모두 지원한다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    const ctx = {
      event: chat('!테스트'),
      query: '입력값',
      commandCount: 7,
      userCount: 3,
      channel: { liveTitle: '오늘의 방송', liveCategory: '리그 오브 레전드' } as ChannelContext,
      users,
      botStartedAt: Date.now() - 3600_000,
    };

    expect(expandVariables('$닉네임 님 안녕', ctx)).toBe('홍길동 님 안녕');
    expect(expandVariables('{닉네임} 님 안녕', ctx)).toBe('홍길동 님 안녕');
    expect(expandVariables('제목: $방제', ctx)).toBe('제목: 오늘의 방송');
    expect(expandVariables('게임: $게임', ctx)).toBe('게임: 리그 오브 레전드');
    expect(expandVariables('$카운트번째', ctx)).toBe('7번째');
    expect(expandVariables('입력: $변수', ctx)).toBe('입력: 입력값');
    expect(expandVariables('$업타임 방송 중', ctx)).toBe('1시간 0분 방송 중');
  });

  it('모르는 변수는 원문 그대로 둔다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    const ctx = {
      event: chat('!x'),
      query: '',
      commandCount: 0,
      userCount: 0,
      channel: { liveTitle: '', liveCategory: '' } as ChannelContext,
      users,
      botStartedAt: Date.now(),
    };
    // 오타를 조용히 지우면 디버깅이 어렵습니다.
    expect(expandVariables('$없는변수 테스트', ctx)).toBe('$없는변수 테스트');
  });

  it('| 로 구분된 후보 중 하나를 고른다', () => {
    expect(pickRandomVariant('A|B|C', () => 0)).toBe('A');
    expect(pickRandomVariant('A|B|C', () => 0.99)).toBe('C');
    expect(pickRandomVariant('구분자 없음', () => 0)).toBe('구분자 없음');
  });
});

// ─── 기타 ─────────────────────────────────────────────────────────────────────

describe('ChatterIndex', () => {
  it('정확히 일치하는 닉네임만 찾는다', () => {
    const index = new ChatterIndex();
    index.remember(chat('안녕', { senderChannelId: 'u1' }));

    expect(index.find('홍길동')?.channelId).toBe('u1');
    expect(index.find('없는사람')).toBeNull();

    // 앞부분 일치는 기본적으로 막습니다. 색인에서 밀려난 사람을 지정했을 때
    // 엉뚱한 사람이 제재당하는 걸 막기 위해서입니다.
    expect(index.find('홍길')).toBeNull();
    expect(index.find('홍길', { allowPrefix: true })?.channelId).toBe('u1');
  });

  it('앞부분 일치 후보가 여럿이면 포기한다', () => {
    const index = new ChatterIndex();
    index.remember(
      chat('a', {
        senderChannelId: 'u1',
        profile: { nickname: '홍길동', badges: [], verifiedMark: false },
      })
    );
    index.remember(
      chat('b', {
        senderChannelId: 'u2',
        profile: { nickname: '홍길순', badges: [], verifiedMark: false },
      })
    );

    // 앞부분 일치를 허용해도 후보가 여럿이면 포기해야 합니다.
    expect(index.find('홍길', { allowPrefix: true })).toBeNull();
    expect(index.find('홍길동')?.channelId).toBe('u1');
  });
});

describe('EventLog', () => {
  it('용량을 넘으면 오래된 것부터 버린다', () => {
    const log = new EventLog(3);
    for (let i = 1; i <= 5; i++) log.push('system', `m${i}`);

    const recent = log.recent(10);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.message).toBe('m5'); // 최신순
  });

  it('sinceId 이후 것만 돌려준다', () => {
    const log = new EventLog();
    log.push('system', 'a');
    const second = log.push('system', 'b');
    log.push('system', 'c');

    expect(log.recent(10, second.id).map((e) => e.message)).toEqual(['c']);
  });
});

// ─── 회귀 테스트 ──────────────────────────────────────────────────────────────

describe('회귀: 게임이 꺼져 있을 때', () => {
  it('베팅 검사가 게임 활성 여부를 스스로 판단하지 않는다', async () => {
    // 예전에는 games.enabled 가 false 면 validate 가 "빈 오류" 를 돌려주고
    // gamble() 이 null 을 반환했는데, 호출자는 null 을 "처리됨" 으로 읽어
    // 같은 이름의 커스텀 명령(!도박 등)을 영영 가로챘다.
    // 이제 활성 여부는 호출자가 판단하고, validate 는 항상 뜻이 분명한 값을 준다.
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    users.addPoints('u1', '길동', 1000);

    const config = botConfig.parse({
      points: { enabled: true },
      games: { enabled: false, minBet: 10, maxBet: 1000, cooldownSec: 0 },
    });

    const engine = new GameEngine(users, () => 0);
    const result = engine.gamble('u1', '길동', '100', config.games, config.points);

    // 엔진 자체는 여전히 결과를 돌려줍니다. 끄고 켜는 판단은 런타임 몫입니다.
    expect(result).not.toBeNull();
    expect(result?.delta).toBe(100);
  });

  it('포인트가 꺼져 있으면 분명한 안내를 준다', async () => {
    const users = await JsonViewerStore.open(join(dir, 'u.json'));
    const config = botConfig.parse({
      points: { enabled: false },
      games: { enabled: true },
    });

    const result = new GameEngine(users, () => 0).gamble(
      'u1',
      '길동',
      '100',
      config.games,
      config.points
    );
    expect(result?.message).toContain('포인트 기능이 꺼져');
    expect(result?.delta).toBe(0);
  });
});

describe('회귀: 구독 즉시 반영', () => {
  it('SUBSCRIPTION 이벤트로 받은 사람은 목록 갱신 전에도 구독자로 인식된다', async () => {
    const { AudienceIndex } = await import('../src/features/audienceIndex.js');
    // 네트워크를 타지 않는 최소 스텁 — 갱신은 어차피 실패해도 됩니다.
    const index = new AudienceIndex(
      {
        channels: {
          get: () => Promise.reject(new Error('x')),
          subscribers: () => Promise.reject(new Error('x')),
        },
      } as never,
      'me'
    );

    expect(index.isSubscriber('newbie')).toBe(false);

    index.noteSubscription({ channelId: 'newbie', nickname: '새구독자', month: 1, tierNo: 1 });

    expect(index.isSubscriber('newbie')).toBe(true);
    expect(index.subscriberOf('newbie')?.channelName).toBe('새구독자');
  });
});

describe('회귀: 금칙어가 스팸보다 먼저', () => {
  it('금칙어 뒤에 자음 연타를 붙여도 금칙어 조치가 적용된다', () => {
    // 예전에는 스팸을 먼저 봐서, "금칙ㅋㅋㅋㅋㅋㅋ" 이 스팸 1회차 경고로
    // 처리되고 금칙어에 설정한 임시제한이 실행되지 않았다.
    // 적발 횟수도 오르지 않아 대시보드에는 쓰인 적 없는 단어로 보였다.
    const config = botConfig.parse({
      moderation: {
        enabled: true,
        allowTempBan: true,
        words: [{ id: 'w1', pattern: '금칙', action: 'blindAndTempBan' }],
        spam: { enabled: true, maxRepeatedChars: 3 },
      },
    });

    const moderator = new Moderator();
    const filter = new SpamFilter();
    const event = chat('금칙ㅋㅋㅋㅋㅋㅋ');

    // 런타임과 같은 순서로 검사합니다.
    const verdict = moderator.inspect(event, config);
    expect(verdict).not.toBeNull();
    expect(verdict?.tempBan).toBe(true);

    // 금칙어에서 걸렸으므로 스팸 검사까지 갈 일이 없습니다.
    // (만약 갔다면 아래가 1회차 경고로 잡힙니다)
    expect(filter.inspect(event, config.moderation.spam)?.violations).toBe(1);
  });
});
