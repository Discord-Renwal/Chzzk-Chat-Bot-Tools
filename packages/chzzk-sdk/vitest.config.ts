import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'chzzk-sdk',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
