import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * 모든 워크스페이스가 공유하는 기본 규칙.
 *
 * 타입 기반 검사(recommendedTypeChecked)를 켜 두었기 때문에 각 패키지에는
 * 해당 파일을 포함하는 tsconfig 가 반드시 있어야 합니다. `projectService` 가
 * 파일 위치에서 가장 가까운 tsconfig 를 알아서 찾습니다.
 */
export const baseConfig = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'off',
    },
  },
  {
    // 설정 파일 자체는 tsconfig 프로젝트에 포함되지 않으므로 타입 기반 검사를 끕니다.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // 테스트는 목(mock) 특성상 await 없는 async 함수와 느슨한 문자열화가 자연스럽습니다.
    files: ['**/tests/**/*.ts', '**/*.test.ts', '**/*.bench.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
  prettier
);

export default baseConfig;
