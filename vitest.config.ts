import { defineConfig } from 'vitest/config';

/**
 * 저장소 전체 테스트 진입점.
 *
 * 각 워크스페이스가 자기 `vitest.config.ts` 를 갖고, 여기서는 그것들을 묶어
 * 한 번에 돌리고 커버리지를 합산합니다. `pnpm test` 는 turbo 를 통해 패키지별로
 * 돌리고, `vitest run` 을 루트에서 직접 부르면 이 설정이 전부를 모읍니다.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/chzzk-sdk',
      'packages/bot-engine',
      'packages/contracts',
      'packages/billing',
      'packages/auth',
      'apps/api',
      'apps/core',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      // 진입점·생성물·예제는 단위 테스트 대상이 아닙니다.
      exclude: [
        '**/index.ts',
        '**/*.d.ts',
        'packages/database/generated/**',
        'apps/*/src/main.ts',
        'docs/examples/**',
      ],
      /**
       * 지금 수치를 바닥으로 고정합니다. 목표치가 아니라 **후퇴 방지선**입니다.
       *
       * 전체 숫자는 낮아 보이지만, 분자와 분모를 나눠 보면 이유가 분명합니다.
       *
       *   높음 (70~90%)  bot-engine/features · state · contracts · auth/crypto
       *                  — 순수 로직이라 단위 테스트가 잘 맞습니다.
       *   0%             database/repositories · api/routes · chzzk-sdk/api
       *                  — 실제 Postgres 나 치지직 서버가 있어야 의미가 있는 코드입니다.
       *                    목으로 덮으면 숫자만 오르고 검증되는 건 목뿐입니다.
       *
       * 뒤쪽은 통합 테스트(테스트 컨테이너)로 덮어야 하고, 그건 별도 작업입니다.
       * 그때까지 커버리지를 **넓게 측정하되 낮은 바닥을 인정**합니다 —
       * include 를 좁혀 숫자를 올리면 안 덮인 코드가 보이지 않게 될 뿐입니다.
       */
      thresholds: {
        statements: 28,
        branches: 23,
        functions: 20,
        lines: 28,
      },
    },
  },
});
