import type { PlanCode, PlanLimits } from './billing.js';

/**
 * 요금제 카탈로그 — 가격과 한도의 단일 진실 공급원.
 *
 * DB 가 아니라 코드에 두는 이유는, 플랜 한도가 **동작을 바꾸는 값**이기 때문입니다.
 * 명령어를 몇 개까지 만들 수 있는지가 환경마다 다르면, 스테이징에서 통과한
 * 한도 검사가 운영에서 다르게 동작합니다. `pnpm db:seed` 가 이 표를 DB 로 밀어
 * 넣고, 런타임은 DB 를 읽습니다(내부 관리자가 특정 채널만 예외 처리할 수 있어야
 * 하므로).
 *
 * 가격은 부가세 포함 원화입니다.
 */

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  description: string;
  priceMonthly: number;
  features: string[];
  limits: PlanLimits;
  isPublic: boolean;
  sortOrder: number;
}

export const PLAN_CATALOG: readonly PlanDefinition[] = [
  {
    code: 'FREE',
    name: '무료',
    description: '취미 방송에 필요한 기본기는 전부 들어 있습니다.',
    priceMonthly: 0,
    features: [
      '커스텀 명령어 10개',
      '자동응답 5개',
      '금칙어 20개',
      '주기 메시지 2개',
      '포인트 · 출석',
      '이벤트 로그 3일 보관',
    ],
    limits: {
      maxCommands: 10,
      maxAutoResponses: 5,
      maxTimers: 2,
      maxBannedWords: 20,
      maxChannels: 1,
      eventRetentionDays: 3,
      gamesEnabled: false,
      songRequestsEnabled: false,
      publicApiEnabled: false,
      apiRateLimitPerMinute: 0,
    },
    isPublic: true,
    sortOrder: 0,
  },
  {
    code: 'STARTER',
    name: '스타터',
    description: '정기 방송을 시작한 스트리머를 위한 구성입니다.',
    priceMonthly: 4900,
    features: [
      '커스텀 명령어 50개',
      '자동응답 30개',
      '금칙어 200개',
      '주기 메시지 10개',
      '미니게임 · 신청곡',
      '이벤트 로그 30일 보관',
    ],
    limits: {
      maxCommands: 50,
      maxAutoResponses: 30,
      maxTimers: 10,
      maxBannedWords: 200,
      maxChannels: 1,
      eventRetentionDays: 30,
      gamesEnabled: true,
      songRequestsEnabled: true,
      publicApiEnabled: false,
      apiRateLimitPerMinute: 0,
    },
    isPublic: true,
    sortOrder: 1,
  },
  {
    code: 'PRO',
    name: '프로',
    description: '매니저와 함께 운영하고 외부 연동까지 쓰는 채널용입니다.',
    priceMonthly: 12900,
    features: [
      '명령어 · 자동응답 무제한',
      '금칙어 무제한',
      '주기 메시지 50개',
      '명령 실행 API (분당 120회)',
      '매니저 초대',
      '이벤트 로그 180일 보관',
    ],
    limits: {
      maxCommands: null,
      maxAutoResponses: null,
      maxTimers: 50,
      maxBannedWords: null,
      maxChannels: 1,
      eventRetentionDays: 180,
      gamesEnabled: true,
      songRequestsEnabled: true,
      publicApiEnabled: true,
      apiRateLimitPerMinute: 120,
    },
    isPublic: true,
    sortOrder: 2,
  },
  {
    code: 'PARTNER',
    name: '파트너',
    description: '여러 채널을 함께 운영하는 팀을 위한 협의 요금제입니다.',
    priceMonthly: 0,
    features: [
      '프로의 모든 기능',
      '채널 10개',
      '명령 실행 API (분당 600회)',
      '이벤트 로그 365일 보관',
      '전담 지원',
    ],
    limits: {
      maxCommands: null,
      maxAutoResponses: null,
      maxTimers: null,
      maxBannedWords: null,
      maxChannels: 10,
      eventRetentionDays: 365,
      gamesEnabled: true,
      songRequestsEnabled: true,
      publicApiEnabled: true,
      apiRateLimitPerMinute: 600,
    },
    // 협의로만 여는 플랜이라 요금제 페이지에는 카드로 띄우지 않습니다.
    isPublic: false,
    sortOrder: 3,
  },
];

export const DEFAULT_PLAN_CODE: PlanCode = 'FREE';
/** 가입 직후 체험시켜 줄 플랜 */
export const TRIAL_PLAN_CODE: PlanCode = 'PRO';

export function findPlanDefinition(code: string): PlanDefinition | undefined {
  return PLAN_CATALOG.find((plan) => plan.code === code);
}
