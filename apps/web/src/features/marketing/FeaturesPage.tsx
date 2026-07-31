import { Card, CardTitle } from '@chzzk-bot/ui';

interface FeatureSection {
  title: string;
  summary: string;
  details: { label: string; body: string }[];
}

/**
 * 기능 소개 상세 (요구사항 1번).
 *
 * 기능 이름만 나열하지 않고 **어떻게 동작하는지**를 씁니다. 챗봇은 비슷한 이름의
 * 기능이 많아서, "자동응답 있음" 만으로는 다른 봇과 구분되지 않습니다. 쿨다운을
 * 어떻게 세는지, 금칙어와 스팸 중 무엇을 먼저 보는지가 실제 차이를 만듭니다.
 */
const SECTIONS: FeatureSection[] = [
  {
    title: '명령어',
    summary: '세 가지 유형으로 대부분의 필요를 덮습니다.',
    details: [
      {
        label: '고정 문구 (text)',
        body: '!디스코드 → 초대 링크처럼 정해진 답을 돌려줍니다. 여러 문장을 넣어 두면 그중 하나를 무작위로 고릅니다.',
      },
      {
        label: '목록 (list)',
        body: '!멤버 빅헤드,9구진 으로 등록하고 !멤버 로 조회합니다. 추가·삭제·초기화 하위 명령을 지원하며, 수정 권한은 역할로 제한합니다.',
      },
      {
        label: '카운터 (counter)',
        body: '!데스 처럼 부를 때마다 1씩 오릅니다. 쿨다운에 막힌 호출은 세지 않아, 연타해도 숫자가 튀지 않습니다.',
      },
      {
        label: '치환자',
        body: '$닉네임 · $방제 · $게임 · $카운트 · $유저카운트 · $포인트 · $순위 등을 응답에 넣을 수 있습니다.',
      },
      {
        label: '구독자 전용',
        body: '구독자 목록을 주기적으로 받아 대조합니다. 스트리머 계정 권한이 필요하며, 관리자에게는 적용하지 않습니다.',
      },
    ],
  },
  {
    title: '조정 · 필터',
    summary: '순서가 곧 정책입니다.',
    details: [
      {
        label: '금칙어를 스팸보다 먼저',
        body: '순서를 바꾸면 금칙어 뒤에 "ㅋㅋㅋㅋ" 만 붙여 스팸(경고)으로 처리되게 만드는 우회가 생깁니다.',
      },
      {
        label: '제재보다 늦은 명령어 처리',
        body: '금칙어를 명령 인자에 실어 보내는 우회를 막기 위해, 명령어는 필터를 통과한 뒤에만 실행됩니다.',
      },
      {
        label: '단계적 제재',
        body: '위반 횟수에 따라 경고 → 임시 제한으로 세집니다. 기록은 설정한 시간이 지나면 사라집니다.',
      },
      {
        label: '한국 채팅 기준',
        body: '영어권 봇의 "대문자 비율" 대신 자음 연타·같은 말 반복·이모티콘 개수·링크 도배를 봅니다.',
      },
    ],
  },
  {
    title: '참여 유도',
    summary: '포인트를 쌓게 하고, 쓸 곳을 만듭니다.',
    details: [
      {
        label: '적립',
        body: '채팅·후원(1000원당)·구독(1개월당)으로 쌓입니다. 같은 사람의 연속 채팅에는 쿨다운이 걸려 도배로 벌 수 없습니다.',
      },
      {
        label: '출석',
        body: '하루 한 번 인정하고 연속일수에 보너스를 줍니다. 날짜는 한국 시간 기준입니다.',
      },
      {
        label: '미니게임',
        body: '도박·주사위·슬롯. 기대값을 1보다 살짝 낮게 잡아 포인트가 무한정 불어나지 않게 했습니다.',
      },
      {
        label: '신청곡',
        body: '포인트를 받고 대기열에 넣습니다. 1인당 개수·전체 상한·중복 제목을 막을 수 있습니다.',
      },
    ],
  },
  {
    title: '운영',
    summary: '방송 중에 필요한 것들.',
    details: [
      {
        label: '!입장 / !퇴장',
        body: '봇은 연결돼 있어도 스트리머나 매니저가 부르기 전에는 말하지 않습니다. 방송 준비 중이나 다른 봇을 쓰는 날에 방해하지 않습니다.',
      },
      {
        label: '실시간 로그',
        body: '명령 실행·제재·후원·구독이 대시보드에 흐릅니다. 플랜에 따라 보관 기간이 다릅니다.',
      },
      {
        label: '치지직 직접 연동',
        body: '활동 제한 목록, 채팅 설정(팔로워 전용·슬로우 모드), 팔로워·구독자 목록을 대시보드에서 그대로 다룹니다.',
      },
      {
        label: '명령 실행 API',
        body: '채팅을 거치지 않고 명령을 실행해 결과 문장을 받습니다. 오버레이·디스코드 연동에 쓰며, 채팅과 같은 엔진을 타므로 결과가 다르지 않습니다.',
      },
    ],
  },
];

export function FeaturesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">기능</h1>
      <p className="mt-3 text-[var(--surface-muted)]">
        치지직 공식 Open API 만 사용합니다. 비공식 API 나 웹 스크래핑을 쓰지 않아 계정이 위험해질
        일이 없습니다.
      </p>

      <div className="mt-10 space-y-6">
        {SECTIONS.map((section) => (
          <Card key={section.title}>
            <CardTitle>{section.title}</CardTitle>
            <p className="mt-1 text-sm text-[var(--surface-muted)]">{section.summary}</p>

            <dl className="mt-5 space-y-4">
              {section.details.map((detail) => (
                <div key={detail.label}>
                  <dt className="text-sm font-semibold">{detail.label}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-[var(--surface-muted)]">
                    {detail.body}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
