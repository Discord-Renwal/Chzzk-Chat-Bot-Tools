import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // 내부 패키지는 TypeScript 소스를 내보내므로 함께 번들해야 합니다.
  noExternal: [/^@chzzk-bot\//],
});
