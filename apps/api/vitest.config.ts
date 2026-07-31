import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
