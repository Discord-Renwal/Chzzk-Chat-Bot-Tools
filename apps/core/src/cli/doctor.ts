/**
 * 환경 구축이 제대로 끝났는지 확인하는 점검 스크립트.
 *
 *   pnpm doctor
 *
 * 클라이언트 인증과 유저 인증을 각각 한 번씩 호출해, 어느 쪽이 막혀 있는지 알려 줍니다.
 */
import { ChzzkApiError } from '@chzzk-bot/chzzk-sdk';
import { createCliClient } from './client.js';

function report(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(18)} ${detail}`);
}

function describe(error: unknown): string {
  if (error instanceof ChzzkApiError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const { chzzk } = createCliClient({ logLevel: 'warn' });

  console.log('\nCHZZK 연결 점검\n');

  // 1) 클라이언트 인증 — Client-Id/Secret 만으로 되는 호출
  try {
    const lives = await chzzk.lives.list({ size: 1 });
    const top = lives.data[0];
    report(
      '클라이언트 인증',
      true,
      top ? `정상 (현재 1위: ${top.channelName} / ${top.concurrentUserCount}명)` : '정상'
    );
  } catch (error) {
    report('클라이언트 인증', false, describe(error));
  }

  // 2) 유저 인증 — 액세스 토큰이 필요한 호출
  try {
    const me = await chzzk.users.me();
    report('유저 인증', true, `${me.channelName} (${me.channelId})`);
  } catch (error) {
    report('유저 인증', false, `${describe(error)}  → \`pnpm login\` 필요`);
  }

  // 3) 채팅 스코프
  try {
    const settings = await chzzk.chat.getSettings();
    report(
      '채팅 설정 조회',
      true,
      `대상=${settings.chatAvailableGroup}, 슬로우=${settings.chatSlowModeSec}s`
    );
  } catch (error) {
    report('채팅 설정 조회', false, describe(error));
  }

  console.log('');
}

main().catch((error: unknown) => {
  console.error('점검 실패:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
