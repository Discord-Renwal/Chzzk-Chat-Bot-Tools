import { lazy, type ReactNode } from 'react';
import {
  AlarmClock,
  Bell,
  Braces,
  Coins,
  Dices,
  Gavel,
  MessagesSquare,
  Music,
  Radio,
  ShieldBan,
  ShieldHalf,
  SlidersHorizontal,
  SlidersVertical,
  TerminalSquare,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { BotConfig, BotStats } from '../../shared/types';

/*
 * 각 페이지는 `lazy()` 로 불러옵니다.
 *
 * 예전에는 대시보드 전체가 한 덩어리라, 일반 탭 하나 보려고 신청곡·미니게임·
 * 제재 관리 코드까지 전부 받아야 했습니다. 페이지별로 쪼개면 처음엔 필요한
 * 것만 받고 나머지는 실제로 열 때 받습니다.
 */
const GeneralPage = lazy(() =>
  import('./pages/GeneralPage').then((m) => ({ default: m.GeneralPage }))
);
const EventsPage = lazy(() =>
  import('./pages/EventsPage').then((m) => ({ default: m.EventsPage }))
);
const CommandsPage = lazy(() =>
  import('./pages/CommandsPage').then((m) => ({ default: m.CommandsPage }))
);
const AutoResponsesPage = lazy(() =>
  import('./pages/AutoResponsesPage').then((m) => ({ default: m.AutoResponsesPage }))
);
const TimersPage = lazy(() =>
  import('./pages/TimersPage').then((m) => ({ default: m.TimersPage }))
);
const NotificationsPage = lazy(() =>
  import('./pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const PointsPage = lazy(() =>
  import('./pages/PointsPage').then((m) => ({ default: m.PointsPage }))
);
const GamesPage = lazy(() => import('./pages/GamesPage').then((m) => ({ default: m.GamesPage })));
const SongsPage = lazy(() => import('./pages/SongsPage').then((m) => ({ default: m.SongsPage })));
const BannedWordsPage = lazy(() =>
  import('./pages/BannedWordsPage').then((m) => ({ default: m.BannedWordsPage }))
);
const RestrictionsPage = lazy(() =>
  import('./pages/RestrictionsPage').then((m) => ({ default: m.RestrictionsPage }))
);
const ChatSettingsPage = lazy(() =>
  import('./pages/ChatSettingsPage').then((m) => ({ default: m.ChatSettingsPage }))
);
const AudiencePage = lazy(() =>
  import('./pages/AudiencePage').then((m) => ({ default: m.AudiencePage }))
);
const PermissionsPage = lazy(() =>
  import('./pages/PermissionsPage').then((m) => ({ default: m.PermissionsPage }))
);
const SystemVariablesPage = lazy(() =>
  import('./pages/SystemVariablesPage').then((m) => ({ default: m.SystemVariablesPage }))
);

/** 페이지에 넘겨줄 값 */
export interface PageContext {
  config: BotConfig;
  stats: BotStats | null;
}

export interface RouteDef {
  /** URL 경로 (앞의 / 제외) */
  path: string;
  label: string;
  icon: LucideIcon;
  group: string;
  /**
   * 설정 없이도 열리는 화면인지.
   * 치지직 서버 상태만 보는 화면들은 봇 설정을 기다릴 필요가 없습니다.
   */
  standalone?: boolean;
  render: (ctx: PageContext) => ReactNode;
}

/**
 * 화면 목록 — 사이드바와 라우터가 **같은 목록**을 봅니다.
 * 따로 두면 화면을 추가할 때 한쪽만 고쳐 링크는 있는데 열리지 않는 일이 생깁니다.
 */
export const ROUTES: RouteDef[] = [
  {
    path: 'general',
    label: '일반',
    icon: SlidersHorizontal,
    group: '상태',
    render: ({ config, stats }) => <GeneralPage config={config} stats={stats} />,
  },
  {
    path: 'events',
    label: '실시간 로그',
    icon: Radio,
    group: '상태',
    standalone: true,
    render: () => <EventsPage />,
  },
  {
    /*
     * 명령어를 "누가 쓰는가" 로 나눕니다.
     *
     * 한 목록에 섞여 있으면 시청자에게 열려 있는 명령과 매니저 전용이 눈으로
     * 구분되지 않습니다. 실수로 관리 명령을 전체 공개로 만들어도 알아채기
     * 어렵고, 그 실수는 방송 중에 드러납니다.
     *
     * 기준은 `useRoles` 에 일반 시청자가 들어 있는지 하나뿐입니다.
     */
    path: 'commands/viewer',
    label: '시청자 명령어',
    icon: TerminalSquare,
    group: '명령어',
    render: ({ config }) => <CommandsPage config={config} audience="viewer" />,
  },
  {
    path: 'commands/admin',
    label: '관리자 명령어',
    icon: ShieldHalf,
    group: '명령어',
    render: ({ config }) => <CommandsPage config={config} audience="admin" />,
  },
  {
    /*
     * 시스템 변수는 **읽기 전용**입니다.
     *
     * 엔진이 해석할 수 있는 것만 존재하므로 사용자가 만들거나 지울 수 없습니다.
     * 목록은 서버(`GET /api/system/variables`)가 소유하고, 이 화면은 그대로
     * 보여주기만 합니다.
     */
    path: 'variables',
    label: '시스템 변수',
    icon: Braces,
    group: '명령어',
    standalone: true,
    render: () => <SystemVariablesPage />,
  },
  {
    path: 'auto',
    label: '자동응답',
    icon: MessagesSquare,
    group: '채팅',
    render: ({ config }) => <AutoResponsesPage config={config} />,
  },
  {
    path: 'timers',
    label: '주기 메시지',
    icon: AlarmClock,
    group: '채팅',
    render: ({ config }) => <TimersPage config={config} />,
  },
  {
    path: 'notifications',
    label: '알림 · 인사',
    icon: Bell,
    group: '채팅',
    render: ({ config }) => <NotificationsPage config={config} />,
  },
  {
    path: 'points',
    label: '포인트',
    icon: Coins,
    group: '참여',
    render: ({ config }) => <PointsPage config={config} />,
  },
  {
    path: 'games',
    label: '미니게임',
    icon: Dices,
    group: '참여',
    render: ({ config }) => <GamesPage config={config} />,
  },
  {
    path: 'songs',
    label: '신청곡',
    icon: Music,
    group: '참여',
    render: ({ config }) => <SongsPage config={config} />,
  },
  {
    path: 'banned',
    label: '금칙어 · 스팸',
    icon: ShieldBan,
    group: '관리',
    render: ({ config }) => <BannedWordsPage config={config} />,
  },
  {
    path: 'restrictions',
    label: '제재 관리',
    icon: Gavel,
    group: '관리',
    standalone: true,
    render: () => <RestrictionsPage />,
  },
  {
    path: 'chat-settings',
    label: '채팅 설정',
    icon: SlidersVertical,
    group: '관리',
    standalone: true,
    render: () => <ChatSettingsPage />,
  },
  {
    path: 'audience',
    label: '팔로워 · 구독자',
    icon: Users,
    group: '관리',
    standalone: true,
    render: () => <AudiencePage />,
  },
  {
    path: 'permissions',
    label: '봇 권한',
    icon: UserCog,
    group: '관리',
    render: ({ config }) => <PermissionsPage config={config} />,
  },
];

/** 사이드바 그룹 순서 — ROUTES 에 나온 순서를 따릅니다. */
export const NAV_GROUPS = [...new Set(ROUTES.map((r) => r.group))];
