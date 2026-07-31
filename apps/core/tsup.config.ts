import { defineConfig } from 'tsup';

/**
 * 워크스페이스 패키지를 **번들에 포함**시킵니다.
 *
 * 내부 패키지들은 빌드 산출물이 아니라 TypeScript 소스를 그대로 내보냅니다
 * (`exports: "./src/index.ts"`). Node 는 .ts 를 읽지 못하므로 배포용 산출물에서는
 * 번들러가 함께 묶어야 합니다. 외부 의존성은 node_modules 에서 그대로 씁니다.
 */
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@chzzk-bot\//],
});
