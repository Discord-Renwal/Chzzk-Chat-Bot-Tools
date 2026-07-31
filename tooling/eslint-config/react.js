import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** 브라우저에서 도는 코드에만 얹는 규칙. `baseConfig` 뒤에 이어 붙여 쓰세요. */
export const reactConfig = tseslint.config({
  files: ['**/*.{ts,tsx}'],
  plugins: { 'react-hooks': reactHooks },
  languageOptions: {
    globals: {
      document: 'readonly',
      window: 'readonly',
      location: 'readonly',
      history: 'readonly',
      navigator: 'readonly',
      localStorage: 'readonly',
      sessionStorage: 'readonly',
      fetch: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      requestAnimationFrame: 'readonly',
      matchMedia: 'readonly',
      console: 'readonly',
      HTMLElement: 'readonly',
      HTMLDivElement: 'readonly',
      HTMLFormElement: 'readonly',
      HTMLInputElement: 'readonly',
      HTMLTextAreaElement: 'readonly',
      HTMLButtonElement: 'readonly',
      HTMLSelectElement: 'readonly',
      IntersectionObserver: 'readonly',
    },
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    // react-hook-form 의 watch() 는 React Compiler 가 메모이즈할 수 없어 경고가 납니다.
    // 라이브러리 쪽 제약이고 우리가 고칠 수 있는 문제가 아니라 끕니다.
    'react-hooks/incompatible-library': 'off',
    // 폼 라이브러리와 Radix 는 제네릭이 깊어 타입 추론이 any 로 새는 지점이 있습니다.
    // 컴포넌트 경계의 props 타입은 유지되므로 이 규칙만 완화합니다.
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { attributes: false } },
    ],
  },
});

export default reactConfig;
