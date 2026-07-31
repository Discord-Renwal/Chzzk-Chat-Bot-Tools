import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'bot-engine',
    include: ['tests/**/*.test.ts'],
    benchmark: { include: ['bench/**/*.bench.ts'] },
    environment: 'node',
  },
});
