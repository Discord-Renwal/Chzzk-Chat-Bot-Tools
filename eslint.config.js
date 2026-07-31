import { baseConfig } from '@chzzk-bot/eslint-config/base';
import { reactConfig } from '@chzzk-bot/eslint-config/react';

/**
 * 저장소 루트 린트 진입점.
 *
 * 규칙 자체는 `tooling/eslint-config` 에 있고 여기서는 어디에 무엇을 적용할지만 정합니다.
 * 브라우저 규칙은 프런트 앱과 공용 UI 패키지에만 얹습니다.
 */
export default [
  ...baseConfig,
  ...reactConfig.map((config) => ({
    ...config,
    files: ['apps/web/**/*.{ts,tsx}', 'apps/backoffice/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
  })),
  {
    // socket.io-client 2.x 는 타입이 느슨해서 파일 단위로 완화합니다.
    files: ['packages/chzzk-sdk/src/session/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    // Prisma 가 만들어내는 클라이언트는 우리 소스가 아닙니다.
    ignores: ['packages/database/generated/**', 'packages/database/prisma/migrations/**'],
  },
];
