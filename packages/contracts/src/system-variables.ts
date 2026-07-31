/**
 * 시스템 변수 카탈로그 — **백엔드가 소유합니다.**
 *
 * 응답 문구에 넣는 `$닉네임`·`{방제}` 같은 치환자 목록입니다. 사용자가 만들거나
 * 지울 수 없고, 엔진이 실제로 해석할 수 있는 것만 존재합니다. 그래서 정의를
 * 서버 쪽(이 공유 패키지)에 두고 화면은 API 로 받아 보여주기만 합니다.
 *
 * 예전에는 프런트에 4개짜리 배열이 하드코딩돼 있었습니다. 엔진에는 20개가
 * 넘게 있는데 화면은 4개만 안내하고 있었고, 반대로 화면에 있는데 엔진이 모르는
 * 이름이 생겨도 아무도 알아채지 못했습니다. 목록이 두 벌이면 반드시 갈라집니다.
 *
 * 여기 이름과 엔진의 resolver 는 테스트가 1:1 로 대조합니다
 * (`packages/bot-engine/tests/variables.test.ts`). 한쪽만 고치면 CI 가 막습니다.
 */

export type SystemVariableGroup = 'person' | 'stream' | 'time' | 'counter' | 'activity' | 'input';

export interface SystemVariable {
  /** 대표 이름. 화면에는 `$이름` 으로 보여줍니다. */
  name: string;
  /** 같은 값을 가리키는 다른 이름들 (영문 표기 등) */
  aliases: string[];
  group: SystemVariableGroup;
  description: string;
  /** 실제로 치환됐을 때 어떻게 보이는지 */
  example: string;
  /**
   * 특정 명령 유형에서만 의미가 있는 변수인지.
   * 예: `$값` 은 목록형에서만 채워집니다.
   */
  onlyFor?: 'list' | 'counter';
}

export const SYSTEM_VARIABLE_GROUP_LABELS: Record<SystemVariableGroup, string> = {
  person: '사람',
  stream: '방송',
  time: '시간',
  counter: '카운터',
  activity: '활동',
  input: '입력값',
};

export const SYSTEM_VARIABLES: readonly SystemVariable[] = [
  {
    name: '닉네임',
    aliases: ['name', 'user'],
    group: 'person',
    description: '명령을 부른 사람의 닉네임',
    example: '방구석연구원',
  },
  {
    name: '방제',
    aliases: ['title'],
    group: 'stream',
    description: '현재 방송 제목',
    example: '오늘은 랭크 갑니다',
  },
  {
    name: '게임',
    aliases: ['카테고리', 'game'],
    group: 'stream',
    description: '현재 방송 카테고리',
    example: 'League of Legends',
  },
  {
    name: '시간',
    aliases: ['time'],
    group: 'time',
    description: '현재 시각 (한국 시간)',
    example: '오후 9:14:02',
  },
  {
    name: '날짜',
    aliases: [],
    group: 'time',
    description: '오늘 날짜 (한국 시간)',
    example: '2026. 7. 30.',
  },
  {
    name: '업타임',
    aliases: ['uptime'],
    group: 'time',
    description: '봇이 켜져 있던 시간',
    example: '2시간 13분',
  },
  {
    name: '카운트',
    aliases: ['count'],
    group: 'counter',
    description: '이 명령이 실행된 총 횟수',
    example: '17',
  },
  {
    name: '유저카운트',
    aliases: ['usercount'],
    group: 'counter',
    description: '이 사람이 이 명령을 부른 횟수',
    example: '3',
  },
  {
    name: '포인트',
    aliases: ['point'],
    group: 'activity',
    description: '부른 사람의 보유 포인트',
    example: '12,800',
  },
  {
    name: '채팅수',
    aliases: [],
    group: 'activity',
    description: '부른 사람의 누적 채팅 수',
    example: '2103',
  },
  {
    name: '출석체크',
    aliases: ['attendance'],
    group: 'activity',
    description: '부른 사람의 연속 출석 일수',
    example: '21',
  },
  {
    name: '변수',
    aliases: ['query'],
    group: 'input',
    description: '명령어 뒤에 붙여 보낸 말 전체',
    example: '안녕하세요',
  },
  {
    name: '값',
    aliases: [],
    group: 'input',
    description: '목록형이 저장하고 있는 항목들',
    example: '빅헤드, 9구진',
    onlyFor: 'list',
  },
  {
    name: '개수',
    aliases: [],
    group: 'input',
    description: '목록형에 저장된 항목 수',
    example: '2',
    onlyFor: 'list',
  },
];

/** 엔진이 인식하는 모든 표기 (대표 이름 + 별칭). 검증에 씁니다. */
export function allSystemVariableNames(): string[] {
  return SYSTEM_VARIABLES.flatMap((variable) => [variable.name, ...variable.aliases]);
}
